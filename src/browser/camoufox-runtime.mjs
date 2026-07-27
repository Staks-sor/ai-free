import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export const CAMOUFOX_PACKAGE_VERSION = "0.5.4";
export const CAMOUFOX_RUNTIME_ROOT = path.join(os.homedir(), ".deepseek-cli", "camoufox");
export const CAMOUFOX_STORAGE_STATE = path.join(CAMOUFOX_RUNTIME_ROOT, "storage-state.json");

const VENV_DIR = path.join(CAMOUFOX_RUNTIME_ROOT, "venv");
const VENV_PYTHON = process.platform === "win32"
  ? path.join(VENV_DIR, "Scripts", "python.exe")
  : path.join(VENV_DIR, "bin", "python");
const BACKGROUND_PYTHON = process.platform === "darwin"
  ? path.join(VENV_DIR, "bin", "ai-free-python")
  : VENV_PYTHON;
const CONFIG_CODE = [
  "import json, sys",
  "from camoufox.utils import launch_options",
  "config = launch_options(headless=True, locale='ru-RU', block_webrtc=True)",
  "open(sys.argv[1], 'w', encoding='utf-8').write(json.dumps(config))",
].join("; ");

let installPromise = null;
let installState = { phase: "idle", message: "" };

function run(command, args, { timeoutMs = 10 * 60_000, onOutput } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timer = null;
    const append = (chunk) => {
      const text = String(chunk || "");
      output = `${output}${text}`.slice(-16_000);
      onOutput?.(text);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ output });
      else reject(new Error(`${path.basename(command)} exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}: ${output.trim()}`));
    });
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(command)} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    timer.unref?.();
  });
}

async function findPython() {
  const configured = String(process.env.AI_FREE_CAMOUFOX_PYTHON || "").trim();
  const candidates = configured
    ? [[configured, []]]
    : process.platform === "win32"
      ? [["py", ["-3"]], ["python", []]]
      : [["python3", []], ["python", []]];

  for (const [command, prefix] of candidates) {
    try {
      await run(command, [...prefix, "--version"], { timeoutMs: 10_000 });
      return { command, prefix };
    } catch {}
  }
  throw new Error("Для Camoufox нужен Python 3. Установите Python и перезапустите AI Free.");
}

async function getRuntimePython() {
  if (process.platform !== "darwin" || !fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
  if (!fs.existsSync(BACKGROUND_PYTHON)) {
    fs.copyFileSync(fs.realpathSync(VENV_PYTHON), BACKGROUND_PYTHON);
    fs.chmodSync(BACKGROUND_PYTHON, 0o755);
    await run("codesign", ["--force", "--sign", "-", BACKGROUND_PYTHON], { timeoutMs: 30_000 });
  }
  return BACKGROUND_PYTHON;
}

async function probeInstalled() {
  if (!fs.existsSync(VENV_PYTHON)) return false;
  try {
    const python = await getRuntimePython();
    await run(python, [
      "-c",
      "from camoufox.pkgman import camoufox_path; print(camoufox_path(False))",
    ], { timeoutMs: 20_000 });
    return true;
  } catch {
    return false;
  }
}

export function getCamoufoxInstallState() {
  return { ...installState, runtimeRoot: CAMOUFOX_RUNTIME_ROOT, version: CAMOUFOX_PACKAGE_VERSION };
}

export async function ensureCamoufoxInstalled() {
  if (await probeInstalled()) {
    installState = { phase: "ready", message: `Camoufox ${CAMOUFOX_PACKAGE_VERSION} готов` };
    return VENV_PYTHON;
  }
  if (process.env.AI_FREE_CAMOUFOX_AUTO_INSTALL === "0") {
    throw new Error("Camoufox не установлен, а автоматическая установка отключена.");
  }
  if (installPromise) return installPromise;

  installPromise = (async () => {
    fs.mkdirSync(CAMOUFOX_RUNTIME_ROOT, { recursive: true });
    const python = await findPython();
    if (!fs.existsSync(VENV_PYTHON)) {
      installState = { phase: "runtime", message: "Подготовка Python runtime для Camoufox…" };
      await run(python.command, [...python.prefix, "-m", "venv", VENV_DIR], { timeoutMs: 2 * 60_000 });
    }
    const runtimePython = await getRuntimePython();
    installState = { phase: "package", message: "Установка Camoufox…" };
    await run(runtimePython, [
      "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
      `camoufox==${CAMOUFOX_PACKAGE_VERSION}`,
    ]);
    installState = { phase: "browser", message: "Загрузка браузера Camoufox (один раз)…" };
    await run(runtimePython, ["-m", "camoufox", "fetch"]);
    installState = { phase: "ready", message: `Camoufox ${CAMOUFOX_PACKAGE_VERSION} готов` };
    return runtimePython;
  })().catch((error) => {
    installState = { phase: "error", message: error.message };
    throw error;
  }).finally(() => {
    installPromise = null;
  });
  return installPromise;
}

export async function launchCamoufoxSession({ viewport = { width: 580, height: 900 } } = {}) {
  await ensureCamoufoxInstalled();
  const python = await getRuntimePython();
  const configPath = path.join(os.tmpdir(), `ai-free-camoufox-${process.pid}-${Date.now()}.json`);
  let raw;
  try {
    await run(python, ["-c", CONFIG_CODE, configPath], { timeoutMs: 45_000 });
    raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } finally {
    try { fs.unlinkSync(configPath); } catch {}
  }
  const { firefox } = await import("playwright");
  const browser = await firefox.launch({
    executablePath: raw.executable_path,
    args: raw.args,
    env: raw.env,
    firefoxUserPrefs: raw.firefox_user_prefs,
    headless: raw.headless,
  });
  const contextOptions = { viewport, locale: "ru-RU", reducedMotion: "reduce" };
  if (fs.existsSync(CAMOUFOX_STORAGE_STATE)) {
    contextOptions.storageState = CAMOUFOX_STORAGE_STATE;
  }
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    fs.mkdirSync(CAMOUFOX_RUNTIME_ROOT, { recursive: true });
    await context.storageState({ path: CAMOUFOX_STORAGE_STATE }).catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  };
  return { browser, context, page, close, mode: "camoufox" };
}
