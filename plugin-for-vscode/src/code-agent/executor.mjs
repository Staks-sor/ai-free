// Исполнитель tool-call'ов от /code-агента. Файловые операции + run_command.
// Все пути валидируются через resolveWorkspacePath: за пределы workspace не выйти.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { COMMAND_CATALOG, loadSettings } from "../state/settings.mjs";

export class WorkspaceToolError extends Error {
  constructor(message, { fatal = false, permissionRequest = null } = {}) {
    super(message);
    this.name = "WorkspaceToolError";
    this.fatal = fatal;
    this.permissionRequest = permissionRequest;
  }
}

import { executeBrowserTool } from "../browser/service.mjs";
import { executeGitHubTool } from "./github-tools.mjs";

export async function executeWorkspaceTool(workspaceRoot, call, executionOptions = {}) {
  const tool = call.tool;

  if (tool === "finish") {
    return { done: true, message: String(call.message || "Done.") };
  }

  if (tool === "list_files") {
    const target = resolveWorkspacePath(workspaceRoot, call.path || ".");
    const maxDepth = clampInteger(call.maxDepth, 0, 8, 4);
    const maxEntries = clampInteger(call.maxEntries, 20, 1000, 500);
    const listing = listFiles(target, workspaceRoot, { maxDepth, maxEntries });
    return {
      ok: true,
      path: path.relative(workspaceRoot, target) || ".",
      ...listing,
    };
  }

  if (tool === "list_serial_ports") {
    return listSerialPorts();
  }

  if (tool === "ask_user") {
    return createUserQuestion(call);
  }

  if (tool === "read_file") {
    const requestedPath = String(call.path || "");
    const target = resolveReadableWorkspacePath(workspaceRoot, requestedPath);
    const maxBytes = clampInteger(call.maxBytes, 1, 2_000_000, 60_000);
    let stat;
    try {
      stat = fs.statSync(target);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`Файл не найден в выбранном проекте: ${requestedPath}. Сначала вызови list_files для уточнения пути.`);
      }
      throw error;
    }
    if (!stat.isFile()) throw new Error(`read_file ожидает файл, но получена папка: ${requestedPath}`);
    const buffer = fs.readFileSync(target);
    if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) {
      throw new Error(`Файл является бинарным и не может быть прочитан как текст: ${requestedPath}`);
    }
    const truncated = buffer.length > maxBytes;
    const content = buffer.subarray(0, maxBytes).toString("utf8");
    return {
      ok: true,
      path: path.relative(workspaceRoot, target),
      bytes: stat.size,
      readBytes: Math.min(buffer.length, maxBytes),
      truncated,
      content,
      ...(truncated ? { hint: `Показаны первые ${maxBytes} байт. Увеличь maxBytes (до 2000000), если нужен остаток файла.` } : {}),
    };
  }

  if (tool === "write_file") {
    const target = resolveWorkspacePath(workspaceRoot, call.path);
    if (typeof call.content !== "string") throw new Error("write_file requires string content.");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, call.content, "utf8");
    return { ok: true, path: path.relative(workspaceRoot, target), bytes: Buffer.byteLength(call.content) };
  }

  if (tool === "append_file") {
    const target = resolveWorkspacePath(workspaceRoot, call.path);
    if (typeof call.content !== "string") throw new Error("append_file requires string content.");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, call.content, "utf8");
    return { ok: true, path: path.relative(workspaceRoot, target), bytes: Buffer.byteLength(call.content) };
  }

  if (tool === "delete_file") {
    requireOwnerApproval("delete_file", call, executionOptions);
    const target = resolveWorkspacePath(workspaceRoot, call.path);
    if (!fs.existsSync(target)) {
      return { ok: true, path: path.relative(workspaceRoot, target), deleted: false, existed: false };
    }
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) {
      throw new Error("delete_file target is a directory. This tool deletes files only.");
    }
    fs.unlinkSync(target);
    return { ok: true, path: path.relative(workspaceRoot, target), deleted: true, existed: true };
  }

  if (tool === "delete_dir") {
    requireOwnerApproval("delete_dir", call, executionOptions);
    const target = resolveWorkspacePath(workspaceRoot, call.path);
    if (!fs.existsSync(target)) {
      return { ok: true, path: path.relative(workspaceRoot, target), deleted: false, existed: false };
    }
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory()) {
      throw new Error("delete_dir target is not a directory.");
    }
    fs.rmSync(target, { recursive: true, force: false });
    return { ok: true, path: path.relative(workspaceRoot, target), deleted: true, existed: true };
  }

  if (tool === "mkdir") {
    const target = resolveWorkspacePath(workspaceRoot, call.path);
    fs.mkdirSync(target, { recursive: true });
    return { ok: true, path: path.relative(workspaceRoot, target) };
  }

  if (tool === "run_command") {
    requireCommandApproval(call, executionOptions);
    return await runWorkspaceCommand(workspaceRoot, call);
  }

  if (tool === "run_shell") {
    requireShellApproval(call, executionOptions);
    return await runWorkspaceShell(workspaceRoot, call);
  }

  if (String(tool || "").startsWith("github_")) {
    if (!GITHUB_READ_ONLY_TOOLS.has(tool)) requireOwnerApproval(tool, call, executionOptions, "external");
    return executeGitHubTool(workspaceRoot, call);
  }

  if (String(tool || "").startsWith("browser_")) {
    return executeBrowserTool(call);
  }

  throw new Error(`Unknown tool: ${tool}`);
}

const GITHUB_READ_ONLY_TOOLS = new Set(["github_status", "github_repo", "github_issues"]);
const DESTRUCTIVE_COMMANDS = new Set(["rm", "rmdir", "unlink", "shred"]);
const EXTERNAL_WRITE_COMMANDS = new Set([
  "ssh", "scp", "sftp", "rsync", "gh", "curl", "wget", "kubectl", "helm", "terraform", "ansible-playbook",
]);

function requireCommandApproval(call, executionOptions) {
  const command = normalizePermissionCommand(String(call.cmd || ""), executionOptions.workspaceRoot);
  const args = Array.isArray(call.args) ? call.args.map(String) : [];
  if (DESTRUCTIVE_COMMANDS.has(command)) requireOwnerApproval(command, call, executionOptions);
  if (command === "git" && ["push", "reset", "clean"].includes(args[0])) {
    requireOwnerApproval(`git ${args[0]}`, call, executionOptions, args[0] === "push" ? "external" : "destructive");
  }
  if (EXTERNAL_WRITE_COMMANDS.has(command)) requireOwnerApproval(command, call, executionOptions, "external");
}

function requireShellApproval(call, executionOptions) {
  const command = String(call.command || "");
  if (/(^|[;&|]\s*)(rm|rmdir|unlink|shred)\b|\bgit\s+(reset|clean)\b/i.test(command)) {
    requireOwnerApproval("destructive shell command", call, executionOptions);
  }
  if (/\b(git\s+push|ssh|scp|sftp|rsync|gh|curl|wget|kubectl|helm|terraform|ansible-playbook)\b/i.test(command)) {
    requireOwnerApproval("external shell command", call, executionOptions, "external");
  }
}

function requireOwnerApproval(action, call, executionOptions, kind = "destructive") {
  const permissionKey = kind === "external" ? "allowExternalWrites" : "allowDestructiveActions";
  if (executionOptions?.[permissionKey] === true) return;
  const target = call.path || call.command || [call.cmd, ...(call.args || [])].filter(Boolean).join(" ");
  const title = kind === "external" ? "Разрешить внешнее изменение" : "Разрешить удаление или опасное действие";
  throw new WorkspaceToolError(`${title}: ${action}${target ? ` (${target})` : ""}. Требуется согласие владельца.`, {
    fatal: true,
    permissionRequest: {
      id: `${permissionKey}-${String(action).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      permissionKey,
      title,
      description: kind === "external"
        ? `Агент хочет изменить внешний ресурс: ${action}${target ? ` — ${target}` : ""}. Разрешение действует до отключения в настройках.`
        : `Агент хочет удалить данные или выполнить опасную операцию: ${action}${target ? ` — ${target}` : ""}. Разрешение действует до отключения в настройках.`,
    },
  });
}

export async function runWorkspaceCommand(workspaceRoot, call) {
  // Whitelist динамический — читаем settings.json на каждый вызов, чтобы изменения
  // в UI применялись сразу без рестарта.
  const settings = loadSettings();
  const allowedCommands = new Set(settings.allowedCommands);
  const cmd = String(call.cmd || "").trim();
  const permissionCommand = normalizePermissionCommand(cmd, workspaceRoot);
  if (!permissionCommand || !allowedCommands.has(permissionCommand)) {
    throw new WorkspaceToolError(`Команда "${cmd}" не разрешена. Включи её в Settings → Allowed commands в окне чата.`, { fatal: true });
  }

  const args = Array.isArray(call.args) ? call.args.map((arg) => String(arg)) : [];
  validateCommandArgs(workspaceRoot, permissionCommand, args, {
    allowPythonModuleAndEval: settings.commandPermissions?.allowPythonModuleAndEval === true,
  });

  // Точечный валидатор аргументов конкретной команды (rm -rf, git clone и т.п.).
  const catalogEntry = COMMAND_CATALOG[permissionCommand];
  if (catalogEntry?.validateArgs) {
    catalogEntry.validateArgs(args);
  }

  const timeoutMs = Math.min(
    Math.max(Number.isFinite(Number(call.timeoutMs)) ? Number(call.timeoutMs) : 20000, 1000),
    30000,
  );

  let result;
  try {
    result = await spawnSyncSafe(cmd, args, {
      cwd: path.resolve(workspaceRoot),
      timeoutMs,
      env: getCommandExecutionEnv(),
    });
  } catch (error) {
    const installRequest = createInstallRequestForMissingCommand(cmd);
    return {
      ok: false,
      cmd,
      args,
      error: error.code === "ENOENT" ? `spawn ${cmd} ENOENT` : error.message,
      installRequest,
    };
  }

  return {
    ok: result.status === 0,
    cmd,
    args,
    status: result.status,
    signal: result.signal,
    timedOut: result.timedOut,
    stdout: truncateOutput(result.stdout),
    stderr: truncateOutput(result.stderr),
  };
}

const TRUSTED_UNIX_COMMAND_DIRS = [
  "/bin",
  "/usr/bin",
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/opt/local/bin",
];

export function normalizePermissionCommand(command, workspaceRoot = "") {
  const cmd = String(command || "").trim();
  if (!cmd) return "";
  if (COMMAND_CATALOG[cmd]) return cmd;

  const normalized = cmd.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  const basename = lower.split("/").pop() || "";
  const isPython = /^python(?:3(?:\.\d+)?)?(?:\.exe)?$/.test(basename) || basename === "py.exe";
  if (!isPython) return "";

  if (TRUSTED_UNIX_COMMAND_DIRS.some((dir) => lower.startsWith(`${dir}/`))) {
    return "python3";
  }
  if (
    /^[a-z]:\/windows\/(?:system32\/)?(?:python|py)(?:3(?:\.\d+)?)?\.exe$/i.test(normalized)
    || /^[a-z]:\/program files(?: \(x86\))?\/.+\/(?:python|py)(?:3(?:\.\d+)?)?\.exe$/i.test(normalized)
    || /^[a-z]:\/users\/[^/]+\/appdata\/local\/programs\/python\/.+\/(?:python|py)(?:3(?:\.\d+)?)?\.exe$/i.test(normalized)
  ) {
    return "python3";
  }
  if (workspaceRoot) {
    const workspace = path.resolve(workspaceRoot);
    const candidate = path.resolve(workspace, cmd);
    if (candidate === workspace || candidate.startsWith(`${workspace}${path.sep}`)) {
      return "python3";
    }
  }
  return "";
}

export async function runWorkspaceShell(workspaceRoot, call) {
  const settings = loadSettings();
  if (settings.commandPermissions?.allowShell !== true) {
    throw new WorkspaceToolError(
      "Shell-команды (пайпы, &&, перенаправления) заблокированы. Включи shell-доступ в Settings → Agent permissions.",
      {
        fatal: true,
        permissionRequest: {
          id: "allow-shell",
          permissionKey: "allowShell",
          title: "Разрешить shell-команды",
          description:
            "Позволяет агенту запускать цепочки команд через run_shell: grep | wc, find + xargs, &&, перенаправления и т.п.",
        },
      },
    );
  }

  const command = String(call.command || "").trim();
  if (!command) {
    throw new WorkspaceToolError("run_shell requires a non-empty command string.", { fatal: true });
  }

  const timeoutMs = Math.min(
    Math.max(Number.isFinite(Number(call.timeoutMs)) ? Number(call.timeoutMs) : 20000, 1000),
    60_000,
  );

  const shellCmd = process.platform === "win32" ? "cmd.exe" : "sh";
  const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];

  let result;
  try {
    result = await spawnSyncSafe(shellCmd, shellArgs, {
      cwd: path.resolve(workspaceRoot),
      timeoutMs,
      env: getCommandExecutionEnv(),
    });
  } catch (error) {
    return {
      ok: false,
      command,
      shell: true,
      error: error.message,
    };
  }

  return {
    ok: result.status === 0,
    command,
    shell: true,
    status: result.status,
    signal: result.signal,
    timedOut: result.timedOut,
    stdout: truncateOutput(result.stdout),
    stderr: truncateOutput(result.stderr),
  };
}

export function createInstallRequestForMissingCommand(cmd) {
  const requests = {
    pio: {
      id: "platformio",
      title: "Установить PlatformIO Core",
      description: "Нужен для обнаружения плат, сборки и прошивки PlatformIO-проектов.",
      command: "python3",
      args: ["-m", "pip", "install", "--user", "platformio"],
    },
    "esptool.py": {
      id: "esptool",
      title: "Установить esptool",
      description: "Нужен для диагностики и прямой прошивки ESP-чипов.",
      command: "python3",
      args: ["-m", "pip", "install", "--user", "esptool"],
    },
    "arduino-cli": {
      id: "arduino-cli",
      title: "Установить arduino-cli",
      description: "Нужен для Arduino-проектов: board list, compile, upload и monitor.",
      command: "brew",
      args: ["install", "arduino-cli"],
    },
  };
  return requests[cmd] || null;
}

export function createUserQuestion(call) {
  const question = String(call.question || "").trim();
  if (!question) {
    return { ok: false, error: "ask_user requires a non-empty question.", fatal: true };
  }
  const choices = Array.isArray(call.choices)
    ? call.choices
        .map((choice) => String(choice).trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];
  return {
    ok: true,
    awaitingUser: true,
    userQuestion: {
      question,
      details: String(call.details || "").trim(),
      choices,
    },
  };
}

export function validateCommandArgs(workspaceRoot, cmd, args, options = {}) {
  if ((cmd === "python" || cmd === "python3" || cmd === "node") && args.length === 0) {
    throw new WorkspaceToolError(`${cmd} without a script is blocked because it opens an interactive REPL. Use write_file/mkdir for file changes, or run a workspace script file.`, { fatal: true });
  }

  const blockedNpmFlags = new Set(["publish", "login", "logout", "token"]);

  if (cmd === "npm" && args.some((arg) => blockedNpmFlags.has(arg))) {
    throw new WorkspaceToolError(`npm ${args.find((arg) => blockedNpmFlags.has(arg))} is blocked.`, { fatal: true });
  }

  if (cmd === "node" && args.some((arg) => ["-e", "--eval", "-p", "--print"].includes(arg))) {
    throw new WorkspaceToolError("node eval/print flags are blocked. Run a workspace file instead.", { fatal: true });
  }

  if (
    (cmd === "python" || cmd === "python3") &&
    args.some((arg) => ["-c", "-m"].includes(arg)) &&
    options.allowPythonModuleAndEval === false
  ) {
    throw new WorkspaceToolError(
      "python -c/-m is blocked. Enable the Python module/eval permission in Settings if you trust this project.",
      {
        fatal: true,
        permissionRequest: {
          id: "allow-python-module-eval",
          permissionKey: "allowPythonModuleAndEval",
          title: "Разрешить Python -m / -c",
          description:
            "Агент попытался запустить Python через -m или -c. Это удобно для модулей вроде python -m package, но рискованнее обычного запуска файла.",
        },
      },
    );
  }

  for (const arg of args) {
    if (!arg || arg.startsWith("-")) continue;
    if (!isNetworkArgAllowed(cmd, arg) && /^https?:\/\//i.test(arg)) {
      throw new WorkspaceToolError("Network URLs are blocked in command args.", { fatal: true });
    }

    if (looksLikePath(arg) && !isAllowedDevicePath(cmd, arg) && !isRemoteTransferArg(cmd, arg)) {
      resolveWorkspacePath(workspaceRoot, arg);
    }
  }
}

const NETWORK_URL_COMMANDS = new Set(["curl", "wget", "gh"]);
const REMOTE_TRANSFER_COMMANDS = new Set(["ssh", "scp", "rsync", "sftp"]);

export function isNetworkArgAllowed(cmd, arg) {
  if (NETWORK_URL_COMMANDS.has(cmd)) return true;
  if (REMOTE_TRANSFER_COMMANDS.has(cmd)) return true;
  if (cmd === "git" && /^https?:\/\//i.test(arg)) return true;
  return /^[\w.@+-]+@[\w.-]+/.test(arg);
}

export function isRemoteTransferArg(cmd, arg) {
  if (!REMOTE_TRANSFER_COMMANDS.has(cmd)) return false;
  return /^[\w.@+-]+@[\w.-]+/.test(arg) || /^[\w.-]+:\//.test(arg);
}

export function isAllowedDevicePath(cmd, value) {
  if (!["pio", "arduino-cli", "esptool.py"].includes(cmd)) return false;
  return /^\/dev\/(cu|tty)[A-Za-z0-9._-]*$/u.test(String(value || ""));
}

export function listSerialPorts() {
  const devDir = "/dev";
  const patterns = [
    /^cu\.(usb|wchusb|serial|SLAB|CP210|wch|modem|Bluetooth|usbserial|usbmodem)/i,
    /^tty\.(usb|wchusb|serial|SLAB|CP210|wch|usbserial|usbmodem)/i,
    /^ttyUSB\d+$/i,
    /^ttyACM\d+$/i,
  ];
  try {
    const entries = fs.readdirSync(devDir)
      .filter((name) => patterns.some((pattern) => pattern.test(name)))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => `${devDir}/${name}`);
    return { ok: true, ports: entries, count: entries.length };
  } catch (error) {
    return { ok: false, ports: [], count: 0, error: error.message };
  }
}

export function looksLikePath(value) {
  return (
    value.startsWith(".") ||
    value.startsWith("/") ||
    value.includes("/") ||
    /\.(mjs|cjs|js|json|py|txt|md|html|css|ts|tsx|jsx)$/i.test(value)
  );
}

export function spawnSyncSafe(cmd, args, options) {
  const child = spawn(cmd, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  return waitForChild(child, options.timeoutMs, {
    onStdout: (chunk) => { stdout += chunk; },
    onStderr: (chunk) => { stderr += chunk; },
    onTimeout: () => {
      timedOut = true;
      child.kill("SIGTERM");
    },
    onClose: (status, signal) => ({ status, signal, timedOut, stdout, stderr }),
  });
}

export function waitForChild(child, timeoutMs, handlers) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => handlers.onTimeout(), timeoutMs);
    child.stdout.on("data", (chunk) => handlers.onStdout(chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => handlers.onStderr(chunk.toString("utf8")));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve(handlers.onClose(status, signal));
    });
  });
}

export function truncateOutput(text) {
  const value = String(text || "");
  return value.length > 12000 ? `${value.slice(0, 12000)}\n[truncated]` : value;
}

export function getCommandExecutionEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    PATH: buildCommandPath(baseEnv),
  };
}

export function buildCommandPath(baseEnv = process.env) {
  const home = baseEnv.HOME || os.homedir();
  const candidates = [
    path.join(home, ".local", "bin"),
    path.join(home, "Library", "Python"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  const pythonRoot = path.join(home, "Library", "Python");
  try {
    for (const entry of fs.readdirSync(pythonRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(path.join(pythonRoot, entry.name, "bin"));
    }
  } catch {}

  const existingPath = String(baseEnv.PATH || "");
  const parts = [...candidates, ...existingPath.split(path.delimiter)]
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index);
  return parts.join(path.delimiter);
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

// Резолв пути к файлу/папке внутри workspace. Гарантирует, что результат
// НЕ выходит за пределы корня и не попадает в .git / node_modules / .env.
export function resolveWorkspacePath(workspaceRoot, requestedPath) {
  if (!requestedPath || typeof requestedPath !== "string") {
    throw new Error("Tool path is required.");
  }

  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, requestedPath);
  const relative = path.relative(root, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${requestedPath}`);
  }

  const parts = relative.split(path.sep);
  if (parts.includes(".git") || parts.includes("node_modules") || parts.includes(".env")) {
    throw new Error(`Path is blocked: ${requestedPath}`);
  }

  return target;
}


export function resolveReadableWorkspacePath(workspaceRoot, requestedPath) {
  const target = resolveWorkspacePath(workspaceRoot, requestedPath);
  if (fs.existsSync(target)) return target;

  // Модели иногда возвращают "project/src/file" при workspace уже равном "project".
  const normalized = String(requestedPath || "").replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts[0] === path.basename(path.resolve(workspaceRoot)) && parts.length > 1) {
    const withoutRepeatedRoot = resolveWorkspacePath(workspaceRoot, parts.slice(1).join("/"));
    if (fs.existsSync(withoutRepeatedRoot)) return withoutRepeatedRoot;
  }
  return target;
}

export function listFiles(target, workspaceRoot, { maxDepth = 4, maxEntries = 500 } = {}) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    return {
      entries: [path.relative(workspaceRoot, target)],
      truncated: false,
      maxDepth,
      maxEntries,
    };
  }

  const result = [];
  let truncated = false;
  const walk = (dir, depth) => {
    if (depth > maxDepth) {
      truncated = true;
      return;
    }
    if (result.length >= maxEntries) {
      truncated = true;
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => ![".git", "node_modules", ".env"].includes(entry.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of entries) {
      if ([".git", "node_modules", ".env"].includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(workspaceRoot, fullPath);
      result.push(entry.isDirectory() ? `${rel}/` : rel);
      if (entry.isDirectory()) walk(fullPath, depth + 1);
      if (result.length >= maxEntries) {
        truncated = true;
        break;
      }
    }
  };

  walk(target, 0);
  return {
    entries: result,
    truncated,
    maxDepth,
    maxEntries,
  };
}
