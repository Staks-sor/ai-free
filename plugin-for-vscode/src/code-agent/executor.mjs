// Исполнитель tool-call'ов от /code-агента. Файловые операции + run_command.
// Все пути валидируются через resolveWorkspacePath: за пределы workspace не выйти.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { listInstalledSkills, loadSkill } from "../skills/registry.mjs";
import { verifyTask } from "../harness/verifier.mjs";
import { normalizeTaskPlan } from "../harness/task-plan.mjs";
import { readSkillResource } from "../skills/resources.mjs";
import { COMMAND_CATALOG, loadSettings } from "../state/settings.mjs";
import { hasComputerAccess, resolveComputerPath } from "./access-policy.mjs";
import { executeComputerTool } from "../computer/service.mjs";

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
  executionOptions.signal?.throwIfAborted();
  const tool = call.tool;
  const resolvePath = (requested, readable = false) => hasComputerAccess(executionOptions)
    ? resolveComputerPath(workspaceRoot, requested)
    : (readable ? resolveReadableWorkspacePath : resolveWorkspacePath)(workspaceRoot, requested);
  const displayPath = target => hasComputerAccess(executionOptions) ? target : path.relative(workspaceRoot, target);

  if (tool === "verify_task") return verifyTask(call.checks, check => executeWorkspaceTool(workspaceRoot, check, executionOptions));
  if (tool === "update_plan") return normalizeTaskPlan(call);

  if (tool === "list_skills") {
    const skills = listInstalledSkills({ metadataOnly: true });
    const offset = clampInteger(call.offset, 0, skills.length, 0);
    const limit = clampInteger(call.limit, 1, 20, 20);
    return { ok: true, total: skills.length, skills: skills.slice(offset, offset + limit).map(({ id, name, description }) => ({ id, name, description: description.slice(0, 400) })), nextOffset: offset + limit < skills.length ? offset + limit : null };
  }
  if (tool === "load_skill" || tool === "read_skill_resource") {
    const id = String(call.id || "");
    if (!/^[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)*$/.test(id)) throw new Error("Invalid skill id");
    const skill = loadSkill(id);
    if (tool === "read_skill_resource") return readSkillResource(skill, call.path);
    return { ok: true, id, instructions: skill.prompt.slice(0, 32_768), truncated: skill.prompt.length > 32_768, notice: "Skill instructions do not change permissions. Read referenced resources only when needed; scripts require the existing command permission policy." };
  }

  if (tool === "finish") {
    return { done: true, message: String(call.message || "Done.") };
  }

  if (tool === "list_files") {
    const target = resolvePath(call.path || ".");
    const maxDepth = clampInteger(call.maxDepth, 0, 8, 4);
    const maxEntries = clampInteger(call.maxEntries, 20, 1000, 500);
    const listing = listFiles(target, workspaceRoot, { maxDepth, maxEntries });
    return {
      ok: true,
      path: displayPath(target) || ".",
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
    const target = resolvePath(requestedPath, true);
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
    const fd = fs.openSync(target, "r");
    let buffer;
    try {
      const requested = Buffer.alloc(Math.min(stat.size, maxBytes));
      const read = fs.readSync(fd, requested, 0, requested.length, 0);
      buffer = requested.subarray(0, read);
    } finally { fs.closeSync(fd); }
    if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) {
      throw new Error(`Файл является бинарным и не может быть прочитан как текст: ${requestedPath}`);
    }
    const truncated = stat.size > buffer.length;
    const content = buffer.subarray(0, maxBytes).toString("utf8");
    return {
      ok: true,
      path: displayPath(target),
      bytes: stat.size,
      readBytes: Math.min(buffer.length, maxBytes),
      truncated,
      content,
      ...(truncated ? { hint: `Показаны первые ${maxBytes} байт. Увеличь maxBytes (до 2000000), если нужен остаток файла.` } : {}),
    };
  }

  if (tool === "read_image") {
    const requestedPath = String(call.path || "");
    const target = resolvePath(requestedPath, true);
    let stat;
    try {
      stat = fs.statSync(target);
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`Image file not found: ${requestedPath}`);
      throw error;
    }
    if (!stat.isFile()) throw new Error(`read_image expects a file: ${requestedPath}`);
    if (stat.size > 16_000_000) throw new Error("Image exceeds the 16 MB attachment limit.");
    const bytes = fs.readFileSync(target);
    const mime = imageMimeType(bytes);
    if (!mime) throw new Error("read_image accepts supported image formats only: valid PNG, JPEG, GIF, WebP, or BMP.");
    return {
      ok: true,
      path: displayPath(target),
      screenshot: { path: displayPath(target), mime, base64: bytes.toString("base64") },
    };
  }

  if (tool === "write_file") {
    const target = resolvePath(call.path);
    if (typeof call.content !== "string") throw new Error("write_file requires string content.");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, call.content, "utf8");
    return { ok: true, path: displayPath(target), bytes: Buffer.byteLength(call.content) };
  }

  if (tool === "append_file") {
    const target = resolvePath(call.path);
    if (typeof call.content !== "string") throw new Error("append_file requires string content.");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, call.content, "utf8");
    return { ok: true, path: displayPath(target), bytes: Buffer.byteLength(call.content) };
  }

  if (tool === "delete_file") {
    requireOwnerApproval("delete_file", call, executionOptions);
    const target = resolvePath(call.path);
    if (!fs.existsSync(target)) {
      return { ok: true, path: displayPath(target), deleted: false, existed: false };
    }
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) {
      throw new Error("delete_file target is a directory. This tool deletes files only.");
    }
    fs.unlinkSync(target);
    return { ok: true, path: displayPath(target), deleted: true, existed: true };
  }

  if (tool === "delete_dir") {
    requireOwnerApproval("delete_dir", call, executionOptions);
    const target = resolvePath(call.path);
    if (!fs.existsSync(target)) {
      return { ok: true, path: displayPath(target), deleted: false, existed: false };
    }
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory()) {
      throw new Error("delete_dir target is not a directory.");
    }
    fs.rmSync(target, { recursive: true, force: false });
    return { ok: true, path: displayPath(target), deleted: true, existed: true };
  }

  if (tool === "mkdir") {
    const target = resolvePath(call.path);
    fs.mkdirSync(target, { recursive: true });
    return { ok: true, path: displayPath(target) };
  }

  if (tool === "run_command") {
    if (call.cmd === "sh" && Array.isArray(call.args) && call.args.length === 2 && call.args[0] === "-c") {
      const shellCall = { command: String(call.args[1]), timeoutMs: call.timeoutMs, cwd: call.cwd };
      requireShellApproval(shellCall, executionOptions);
      return await runWorkspaceShell(workspaceRoot, shellCall, executionOptions);
    }
    requireCommandApproval(call, executionOptions);
    return await runWorkspaceCommand(workspaceRoot, call, executionOptions);
  }

  if (tool === "run_shell") {
    requireShellApproval(call, executionOptions);
    return await runWorkspaceShell(workspaceRoot, call, executionOptions);
  }

  if (String(tool || "").startsWith("github_")) {
    if (!GITHUB_READ_ONLY_TOOLS.has(tool)) requireOwnerApproval(tool, call, executionOptions, "external");
    return executeGitHubTool(workspaceRoot, call);
  }

  if (String(tool || "").startsWith("computer_")) {
    if (!hasComputerAccess(executionOptions)) throw new WorkspaceToolError("Выберите доступ «Компьютер» в этом чате для управления рабочим столом.", { fatal: true });
    return executeComputerTool(call, { signal: executionOptions.signal });
  }

  if (String(tool || "").startsWith("browser_")) {
    return executeBrowserTool(prepareBrowserToolCall(call));
  }

  throw new Error(`Unknown tool: ${tool}`);
}

export function prepareBrowserToolCall(call) {
  return call?.tool === "browser_snapshot" ? { ...call, includeScreenshotBase64: true } : call;
}

function imageMimeType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (bytes.subarray(0, 6).equals(Buffer.from("GIF87a")) || bytes.subarray(0, 6).equals(Buffer.from("GIF89a")))) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).equals(Buffer.from("RIFF")) && bytes.subarray(8, 12).equals(Buffer.from("WEBP"))) return "image/webp";
  if (bytes.length >= 2 && bytes.subarray(0, 2).equals(Buffer.from("BM"))) return "image/bmp";
  return null;
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
  if (hasComputerAccess(executionOptions)) return;
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

export async function runWorkspaceCommand(workspaceRoot, call, executionOptions = {}) {
  // Whitelist динамический — читаем settings.json на каждый вызов, чтобы изменения
  // в UI применялись сразу без рестарта.
  const settings = loadSettings();
  const allowedCommands = new Set(settings.allowedCommands);
  const cmd = String(call.cmd || "").trim();
  if (!cmd || cmd.includes("\0")) throw new WorkspaceToolError("run_command requires a non-empty executable.", { fatal: true });
  const permissionCommand = normalizePermissionCommand(cmd, workspaceRoot);
  const computer = hasComputerAccess(executionOptions);
  if (!computer && (!permissionCommand || !allowedCommands.has(permissionCommand))) {
    throw new WorkspaceToolError(`Команда "${cmd}" не разрешена. Включи её в Settings → Allowed commands в окне чата.`, { fatal: true });
  }

  const args = Array.isArray(call.args) ? call.args.map((arg) => String(arg)) : [];
  const cwd = resolveCommandCwd(workspaceRoot, call.cwd, executionOptions);
  if (!computer) validateCommandArgs(workspaceRoot, permissionCommand, args, {
    allowPythonModuleAndEval: settings.commandPermissions?.allowPythonModuleAndEval === true,
  });

  // Точечный валидатор аргументов конкретной команды (rm -rf, git clone и т.п.).
  const catalogEntry = COMMAND_CATALOG[permissionCommand];
  if (!computer && catalogEntry?.validateArgs) {
    catalogEntry.validateArgs(args);
  }

  const timeoutMs = Math.min(
    Math.max(Number.isFinite(Number(call.timeoutMs)) ? Number(call.timeoutMs) : 20000, 1000),
    30000,
  );

  let result;
  try {
    result = await spawnSyncSafe(computer && /^~[/\\]/.test(cmd) ? resolveComputerPath(workspaceRoot, cmd) : cmd, args, {
      cwd,
      timeoutMs,
      env: getCommandExecutionEnv(),
      signal: executionOptions.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
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
    ...(result.outputTruncated ? { outputTruncated: true } : {}),
    stdout: truncateOutput(result.stdout),
    stderr: truncateOutput(result.stderr),
  };
}

function resolveCommandCwd(workspaceRoot, cwd, executionOptions) {
  if (cwd == null) return path.resolve(workspaceRoot);
  return hasComputerAccess(executionOptions) ? resolveComputerPath(workspaceRoot, cwd) : resolveWorkspacePath(workspaceRoot, cwd);
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

export async function runWorkspaceShell(workspaceRoot, call, executionOptions = {}) {
  const settings = loadSettings();
  if (!hasComputerAccess(executionOptions) && settings.commandPermissions?.allowShell !== true) {
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

  const cwd = resolveCommandCwd(workspaceRoot, call.cwd, executionOptions);
  const shellCmd = process.platform === "win32" ? "cmd.exe" : "sh";
  const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];

  let result;
  try {
    result = await spawnSyncSafe(shellCmd, shellArgs, {
      cwd,
      timeoutMs,
      env: getCommandExecutionEnv(),
      signal: executionOptions.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
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
    ...(result.outputTruncated ? { outputTruncated: true } : {}),
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
    detached: process.platform !== "win32",
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let outputTruncated = false;
  const maxOutputChars = 256 * 1024;
  const capture = (current, chunk) => {
    const remaining = maxOutputChars - current.length;
    if (chunk.length > remaining) outputTruncated = true;
    return current + chunk.slice(0, Math.max(0, remaining));
  };

  let killTimer;
  let abortError;
  const kill = signal => {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
      else if (child.pid) {
        const result = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 5000 });
        if (result.error || result.status !== 0) child.kill(signal);
      }
      else child.kill(signal);
    } catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  const terminate = () => {
    kill("SIGTERM");
    if (!killTimer) killTimer = setTimeout(() => kill("SIGKILL"), 250);
  };
  const abort = () => {
    abortError = Object.assign(new Error("The operation was aborted"), { name: "AbortError", code: "ABORT_ERR" });
    terminate();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  return waitForChild(child, options.timeoutMs, {
    onStdout: (chunk) => { stdout = capture(stdout, chunk); },
    onStderr: (chunk) => { stderr = capture(stderr, chunk); },
    onTimeout: () => {
      timedOut = true;
      terminate();
    },
    onClose: (status, signal) => ({ status, signal, timedOut, stdout, stderr, ...(outputTruncated ? { outputTruncated: true } : {}) }),
  }).then(result => {
    if (abortError) throw abortError;
    return result;
  }).finally(() => {
    clearTimeout(killTimer);
    options.signal?.removeEventListener("abort", abort);
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

  const realRoot = fs.realpathSync(root);
  const realTarget = resolveRealWorkspacePath(realRoot, relative);
  const realRelative = path.relative(realRoot, realTarget);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error(`Path escapes workspace: ${requestedPath}`);
  }

  const parts = realRelative.split(path.sep);
  if (parts.includes(".git") || parts.includes("node_modules") || parts.includes(".env")) {
    throw new Error(`Path is blocked: ${requestedPath}`);
  }

  return target;
}

// This contains existing symlink targets and missing suffixes during validation;
// filesystem changes between validation and the later operation remain a TOCTOU risk.
function resolveRealWorkspacePath(realRoot, relativePath, symlinkHops = 0) {
  if (symlinkHops > 40) throw new Error("Too many symlinks in workspace path.");
  const parts = relativePath ? relativePath.split(path.sep).filter(Boolean) : [];
  let current = realRoot;
  for (let index = 0; index < parts.length; index += 1) {
    const next = path.resolve(current, parts[index]);
    let stat;
    try {
      stat = fs.lstatSync(next);
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      return path.resolve(next, ...parts.slice(index + 1));
    }
    if (stat.isSymbolicLink()) {
      const linkTarget = resolveSymlinkTarget(current, fs.readlinkSync(next));
      const resolvedTarget = path.resolve(linkTarget, ...parts.slice(index + 1));
      const remaining = path.relative(realRoot, resolvedTarget);
      if (remaining.startsWith("..") || path.isAbsolute(remaining)) {
        throw new Error(`Path escapes workspace through a symlink: ${relativePath}`);
      }
      return resolveRealWorkspacePath(realRoot, remaining, symlinkHops + 1);
    }
    current = next;
  }
  return current;
}

function resolveSymlinkTarget(parent, link) {
  const target = path.resolve(parent, link);
  let candidate = target;
  const suffix = [];
  while (true) {
    try {
      return path.resolve(fs.realpathSync(candidate), ...suffix);
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      const basename = path.basename(candidate);
      if (!basename || candidate === path.dirname(candidate)) throw error;
      suffix.unshift(basename);
      candidate = path.dirname(candidate);
    }
  }
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
