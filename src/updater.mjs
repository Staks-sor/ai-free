import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { AI_FREE_VERSION } from "./config.mjs";

const execFileAsync = promisify(execFile);

const REPO_OWNER = "Staks-sor";
const REPO_NAME = "ai-free";
const DEFAULT_BRANCH = "main";
const RAW_PACKAGE_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${DEFAULT_BRANCH}/package.json`;
const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

function projectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function normalizeVersion(version) {
  return String(version || "").trim().replace(/^v/i, "");
}

function readCurrentVersion(root = projectRoot()) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : AI_FREE_VERSION;
  } catch {
    return AI_FREE_VERSION;
  }
}

export function compareVersions(a, b) {
  const left = normalizeVersion(a).split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const right = normalizeVersion(b).split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const length = Math.max(left.length, right.length, 3);
  for (let index = 0; index < length; index += 1) {
    const l = Number.isFinite(left[index]) ? left[index] : 0;
    const r = Number.isFinite(right[index]) ? right[index] : 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function windowsCommandScript(command) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(String(command || ""));
}

function commandCandidatePaths(command) {
  if (process.platform !== "win32") return [command];
  const env = process.env;
  if (command === "git") {
    return unique([
      "git",
      "git.exe",
      env.ProgramFiles && path.join(env.ProgramFiles, "Git", "cmd", "git.exe"),
      env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "Git", "cmd", "git.exe"),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", "Git", "cmd", "git.exe"),
    ]);
  }
  if (command === "npm") {
    return unique([
      "npm",
      "npm.cmd",
      env.APPDATA && path.join(env.APPDATA, "npm", "npm.cmd"),
      env.ProgramFiles && path.join(env.ProgramFiles, "nodejs", "npm.cmd"),
      env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "nodejs", "npm.cmd"),
    ]);
  }
  return [command];
}

function normalizeExecutable(executable) {
  if (typeof executable === "string") {
    return {
      command: executable,
      prefixArgs: [],
      shell: windowsCommandScript(executable),
    };
  }
  return {
    command: executable.command,
    prefixArgs: executable.prefixArgs || [],
    shell: executable.shell === true || windowsCommandScript(executable.command),
  };
}

async function executableWorks(executable, args = ["--version"]) {
  const resolved = normalizeExecutable(executable);
  try {
    await execFileAsync(resolved.command, [...resolved.prefixArgs, ...args], {
      shell: resolved.shell,
      timeout: 10_000,
      maxBuffer: 100_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveCommand(command) {
  for (const candidate of commandCandidatePaths(command)) {
    if (await executableWorks(candidate)) return normalizeExecutable(candidate);
  }
  return null;
}

async function resolveNpmCommand() {
  const npmExecPath = process.env.npm_execpath;
  const npmNodePath = process.env.npm_node_execpath;
  if (npmExecPath && fs.existsSync(npmExecPath) && npmNodePath && fs.existsSync(npmNodePath)) {
    const executable = { command: npmNodePath, prefixArgs: [npmExecPath], shell: false };
    if (await executableWorks(executable)) return executable;
  }
  return resolveCommand("npm");
}

function executableDisplayName(executable, fallback) {
  if (!executable) return fallback;
  const resolved = normalizeExecutable(executable);
  return [resolved.command, ...resolved.prefixArgs].filter(Boolean).join(" ");
}

async function runGit(args, options = {}) {
  const gitCommand = options.gitCommand || await resolveCommand("git");
  if (!gitCommand) throw new Error("Не найден git. Установи Git или открой страницу релиза для ручного обновления.");
  const result = await runCommand(gitCommand, args, {
    cwd: options.cwd || projectRoot(),
    timeout: options.timeout || 120_000,
    maxBuffer: options.maxBuffer || 2_000_000,
  });
  return String(result || "").trim();
}

async function readRemotePackage() {
  const response = await fetch(RAW_PACKAGE_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GitHub вернул HTTP ${response.status}`);
  }
  const pkg = await response.json();
  return {
    version: typeof pkg.version === "string" ? pkg.version : "",
    url: RAW_PACKAGE_URL,
  };
}

async function readLocalCommit(root, gitCommand) {
  try {
    return await runGit(["rev-parse", "HEAD"], { cwd: root, gitCommand });
  } catch {
    return "";
  }
}

async function readRemoteCommit(root, gitCommand) {
  try {
    const output = await runGit(["ls-remote", "origin", `refs/heads/${DEFAULT_BRANCH}`], {
      cwd: root,
      gitCommand,
      timeout: 120_000,
    });
    return output.split(/\s+/)[0] || "";
  } catch {
    return "";
  }
}

export async function checkForUpdate() {
  const root = projectRoot();
  const currentVersion = readCurrentVersion(root);
  const [gitCommand, npmCommand] = await Promise.all([
    resolveCommand("git"),
    resolveNpmCommand(),
  ]);
  const [remotePackage, localCommit, remoteCommit] = await Promise.all([
    readRemotePackage().catch((error) => ({ version: "", error: error.message, url: RAW_PACKAGE_URL })),
    gitCommand ? readLocalCommit(root, gitCommand) : "",
    gitCommand ? readRemoteCommit(root, gitCommand) : "",
  ]);
  const latestVersion = remotePackage.version || "";
  const versionCompare = latestVersion ? compareVersions(currentVersion, latestVersion) : 0;
  const updateAvailable =
    versionCompare < 0 || (versionCompare === 0 && localCommit && remoteCommit && localCommit !== remoteCommit);

  return {
    ok: !remotePackage.error,
    currentVersion,
    latestVersion,
    updateAvailable,
    localCommit,
    remoteCommit,
    canUpdate: Boolean(gitCommand) && fs.existsSync(path.join(root, ".git")),
    canInstallDependencies: Boolean(npmCommand),
    updateMethod: npmCommand ? "git+npm" : "git",
    updateWarning: npmCommand
      ? ""
      : "npm не найден. AI Free обновит код через git; если изменились зависимости, понадобится установить Node.js/npm и повторить обновление.",
    projectRoot: root,
    source: remotePackage.url,
    releasesUrl: RELEASES_URL,
    gitCommand: executableDisplayName(gitCommand, "git"),
    npmCommand: npmCommand ? executableDisplayName(npmCommand, "npm") : "",
    error: remotePackage.error || "",
  };
}

async function runCommand(command, args, options = {}) {
  const executable = normalizeExecutable(command);
  const result = await execFileAsync(executable.command, [...executable.prefixArgs, ...args], {
    cwd: options.cwd || projectRoot(),
    shell: executable.shell,
    timeout: options.timeout || 600_000,
    maxBuffer: options.maxBuffer || 8_000_000,
  });
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

export async function runUpdate() {
  const root = projectRoot();
  if (!fs.existsSync(path.join(root, ".git"))) {
    throw new Error("Автообновление доступно только для установки из git clone.");
  }
  const [gitCommand, npmCommand] = await Promise.all([
    resolveCommand("git"),
    resolveNpmCommand(),
  ]);
  if (!gitCommand) {
    throw new Error("Не найден git. Установи Git или скачай новую версию вручную со страницы релиза.");
  }

  const before = await checkForUpdate();
  if (!before.updateAvailable) {
    return {
      ok: true,
      updated: false,
      message: "Установлена актуальная версия.",
      before,
      after: before,
      logs: [],
    };
  }

  const logs = [];
  const beforeCommit = before.localCommit || await readLocalCommit(root, gitCommand);
  logs.push(await runCommand(gitCommand, ["fetch", "--prune", "origin"], { cwd: root, timeout: 180_000 }));
  logs.push(await runCommand(gitCommand, ["pull", "--ff-only", "origin", DEFAULT_BRANCH], { cwd: root, timeout: 180_000 }));

  const afterPullCommit = await readLocalCommit(root, gitCommand);
  let changedFiles = [];
  if (beforeCommit && afterPullCommit && beforeCommit !== afterPullCommit) {
    const changedOutput = await runCommand(gitCommand, ["diff", "--name-only", `${beforeCommit}..${afterPullCommit}`], {
      cwd: root,
      timeout: 60_000,
      maxBuffer: 1_000_000,
    }).catch(() => "");
    changedFiles = String(changedOutput || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  const dependencyFilesChanged = changedFiles.some((file) =>
    file === "package.json" || file === "package-lock.json" || file === "npm-shrinkwrap.json"
  );
  let skippedDependencyInstall = false;
  if (npmCommand) {
    logs.push(await runCommand(npmCommand, ["install"], {
      cwd: root,
      timeout: 900_000,
      maxBuffer: 12_000_000,
    }));
  } else {
    skippedDependencyInstall = true;
    logs.push("npm не найден: установка зависимостей пропущена.");
  }

  const after = await checkForUpdate();
  const restartReady = !(skippedDependencyInstall && dependencyFilesChanged);
  return {
    ok: true,
    updated: true,
    restartReady,
    skippedDependencyInstall,
    dependencyFilesChanged,
    message: skippedDependencyInstall
      ? dependencyFilesChanged
        ? "Код обновлён, но зависимости изменились, а npm не найден. Установи Node.js/npm и повтори обновление перед перезапуском."
        : "Код обновлён. npm не найден, но зависимости не менялись, можно перезапустить AI Free."
      : "Обновление установлено. Перезапусти AI Free, чтобы загрузить новый код.",
    before,
    after,
    logs: logs.filter(Boolean),
  };
}

export function scheduleWindowRestart({ port = 4317, workspaceRoot = process.cwd(), delayMs = 1800 } = {}) {
  const root = projectRoot();
  const entry = path.join(root, "bin", "deepseek.mjs");
  const payload = Buffer.from(JSON.stringify({
    node: process.execPath,
    args: [
      entry,
      "--window",
      "--port",
      String(port),
      "--workspace",
      workspaceRoot,
    ],
    cwd: root,
    env: {
      ...process.env,
      AI_FREE_RESTARTED_AFTER_UPDATE: "1",
    },
    delayMs,
  }), "utf8").toString("base64");
  const code = [
    'const { spawn } = require("node:child_process");',
    'const payload = JSON.parse(Buffer.from(process.argv[1], "base64").toString("utf8"));',
    'setTimeout(() => {',
    '  const child = spawn(payload.node, payload.args, { cwd: payload.cwd, env: payload.env, detached: true, stdio: "ignore" });',
    '  child.unref();',
    '}, payload.delayMs);',
  ].join("\n");
  const launcher = spawn(process.execPath, ["-e", code, payload], {
    cwd: root,
    detached: true,
    stdio: "ignore",
  });
  launcher.unref();
}
