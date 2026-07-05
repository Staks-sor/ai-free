import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { AI_FREE_VERSION } from "./config.mjs";

const execFileAsync = promisify(execFile);

const REPO_OWNER = "Staks-sor";
const REPO_NAME = "ai-free";
const DEFAULT_BRANCH = "main";
const RAW_PACKAGE_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${DEFAULT_BRANCH}/package.json`;

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

async function runGit(args, options = {}) {
  const result = await execFileAsync("git", args, {
    cwd: options.cwd || projectRoot(),
    timeout: options.timeout || 120_000,
    maxBuffer: options.maxBuffer || 2_000_000,
  });
  return String(result.stdout || "").trim();
}

async function commandExists(command) {
  try {
    await execFileAsync(command, ["--version"], { timeout: 10_000, maxBuffer: 100_000 });
    return true;
  } catch {
    return false;
  }
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

async function readLocalCommit(root) {
  try {
    return await runGit(["rev-parse", "HEAD"], { cwd: root });
  } catch {
    return "";
  }
}

async function readRemoteCommit(root) {
  try {
    const output = await runGit(["ls-remote", "origin", `refs/heads/${DEFAULT_BRANCH}`], {
      cwd: root,
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
  const [remotePackage, localCommit, remoteCommit, hasGit] = await Promise.all([
    readRemotePackage().catch((error) => ({ version: "", error: error.message, url: RAW_PACKAGE_URL })),
    readLocalCommit(root),
    readRemoteCommit(root),
    commandExists("git"),
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
    canUpdate: hasGit && fs.existsSync(path.join(root, ".git")),
    projectRoot: root,
    source: remotePackage.url,
    error: remotePackage.error || "",
  };
}

async function runCommand(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd || projectRoot(),
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
  if (!(await commandExists("git"))) {
    throw new Error("Не найден git в PATH.");
  }
  if (!(await commandExists("npm"))) {
    throw new Error("Не найден npm в PATH.");
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
  logs.push(await runCommand("git", ["fetch", "--prune", "origin"], { cwd: root, timeout: 180_000 }));
  logs.push(await runCommand("git", ["pull", "--ff-only", "origin", DEFAULT_BRANCH], { cwd: root, timeout: 180_000 }));
  logs.push(await runCommand(process.platform === "win32" ? "npm.cmd" : "npm", ["install"], {
    cwd: root,
    timeout: 900_000,
    maxBuffer: 12_000_000,
  }));

  const after = await checkForUpdate();
  return {
    ok: true,
    updated: true,
    message: "Обновление установлено. Перезапусти AI Free, чтобы загрузить новый код.",
    before,
    after,
    logs: logs.filter(Boolean),
  };
}
