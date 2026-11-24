import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { readInitialStorageState, restoreInitialStorageState } from "./storage-bootstrap.mjs";
import { writeAtomicJsonSync } from "../state/state-writer.mjs";

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
export const CAMOUFOX_CONFIG_CODE = `import json, os, sys
from camoufox.utils import launch_options
saved = json.load(open(sys.argv[3], encoding='utf-8')) if sys.argv[3] and os.path.isfile(sys.argv[3]) else None
# Old JS serialization rounded GL_MAX_SERVER_WAIT_TIMEOUT past uint64.
if saved and saved.get('webGl2:parameters', {}).get('37137') == 18446744073709552000:
    saved['webGl2:parameters']['37137'] = 18446744073709551615
    repaired_path = sys.argv[3] + '.tmp-' + str(os.getpid())
    with open(repaired_path, 'w', encoding='utf-8') as repaired:
        json.dump(saved, repaired)
    os.chmod(repaired_path, 0o600)
    os.replace(repaired_path, sys.argv[3])
config = launch_options(config=saved, headless=sys.argv[2] == '1', locale='ru-RU', block_webrtc=True, i_know_what_im_doing=bool(saved))
with open(sys.argv[1], 'w', encoding='utf-8') as output:
    json.dump(config, output)
`;


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

export async function findPython({ execute = run, platform = process.platform,
  configured = String(process.env.AI_FREE_CAMOUFOX_PYTHON || "").trim() } = {}) {
  const candidates = configured
    ? [[configured, []]]
    : platform === "win32"
      ? [["py", ["-3"]], ["python", []]]
      : [["python3", []], ["python", []]];

  for (const [command, prefix] of candidates) {
    try {
      const { output } = await execute(command, [...prefix, "--version"], { timeoutMs: 10_000 });
      const version = /Python\s+(\d+)\.(\d+)/i.exec(output || '');
      if (version && Number(version[1]) === 3 && Number(version[2]) >= 10) return { command, prefix };
    } catch {}
  }
  throw Object.assign(new Error('Для входа нужен Python 3.10 или новее (Python 3). Установите его с python.org, затем полностью перезапустите IDE.'), {
    code: 'CAMOUFOX_PYTHON_REQUIRED', userMessage: 'Для входа нужен Python 3.10 или новее (Python 3). Установите его с python.org, затем полностью перезапустите IDE.', delivery: 'not_sent',
  });
}

export function browserSetupError(phase, cause) {
  if (cause?.userMessage && /^CAMOUFOX_/.test(cause.code || '')) return cause;
  const messages = {
    runtime: 'Не удалось подготовить Python-окружение браузера. Проверьте права записи и работу Python 3.10+, затем повторите подключение.',
    package: 'Не удалось установить Camoufox. Проверьте доступ к pypi.org, настройки сети/VPN и повторите подключение.',
    browser: 'Не удалось скачать браузер Camoufox. Проверьте сеть/VPN и доступ к загрузкам GitHub, затем повторите подключение.',
    launch: 'Не удалось запустить браузер входа. Проверьте, не блокирует ли его система, и закройте прежнее окно этого аккаунта перед повтором.',
  };
  const message = messages[phase] || 'Не удалось подготовить браузер входа. Повторите подключение.';
  return Object.assign(new Error(message), { code: 'CAMOUFOX_' + phase.toUpperCase() + '_FAILED', userMessage: message, delivery: 'not_sent', cause });
}

export function getBrowserLoginProgress(login, setup = getCamoufoxInstallState()) {
  if (login.state !== 'running') return login;
  if (['python', 'runtime', 'package', 'browser'].includes(setup.phase)) return { ...login, phase: setup.phase, message: setup.message };
  return { ...login, phase: login.phase || 'login', message: login.message || 'Открываем браузер входа или ожидаем завершения авторизации…' };
}

async function setupStep(phase, message, work) {
  installState = { phase, message };
  try { return await work(); } catch (cause) { throw browserSetupError(phase, cause); }
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

export function buildCamoufoxContextOptions({
  viewport = { width: 580, height: 900 },
  storageStatePath = CAMOUFOX_STORAGE_STATE,
} = {}) {
  const options = { viewport, locale: "ru-RU", reducedMotion: "reduce" };
  if (storageStatePath && fs.existsSync(storageStatePath)) {
    options.storageState = storageStatePath;
  }
  return options;
}

export function saveCamoufoxFingerprint(raw, fingerprintStatePath) {
  if (!fingerprintStatePath || fs.existsSync(fingerprintStatePath)) return;
  const chunks = Object.entries(raw?.env || {})
    .filter(([key]) => /^CAMOU_CONFIG_\d+$/.test(key))
    .sort(([left], [right]) => Number(left.slice(13)) - Number(right.slice(13)))
    .map(([, value]) => value);
  if (!chunks.length) throw new Error("Camoufox did not provide a browser fingerprint");
  const fingerprint = chunks.join("");
  JSON.parse(fingerprint);
  fs.mkdirSync(path.dirname(fingerprintStatePath), { recursive: true });
  try {
    fs.writeFileSync(fingerprintStatePath, fingerprint, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}

export async function ensureCamoufoxInstalled() {
  if (await probeInstalled()) {
    installState = { phase: "ready", message: `Camoufox ${CAMOUFOX_PACKAGE_VERSION} готов` };
    return VENV_PYTHON;
  }
  if (process.env.AI_FREE_CAMOUFOX_AUTO_INSTALL === "0") {
    const message = "Camoufox не установлен, а автоматическая установка отключена (AI_FREE_CAMOUFOX_AUTO_INSTALL=0). Разрешите установку и повторите подключение.";
    throw Object.assign(new Error(message), { code: 'CAMOUFOX_INSTALL_DISABLED', userMessage: message, delivery: 'not_sent' });
  }
  if (installPromise) return installPromise;

  installPromise = (async () => {
    await setupStep('runtime', 'Подготавливаем папку браузера…', () => fs.mkdirSync(CAMOUFOX_RUNTIME_ROOT, { recursive: true }));
    installState = { phase: 'python', message: 'Проверяем Python 3.10+ для браузера входа…' };
    const python = await findPython();
    if (fs.existsSync(VENV_PYTHON)) {
      await setupStep('runtime', 'Проверяем совместимость сохранённого окружения браузера…', async () => {
        try { await findPython({ configured: VENV_PYTHON }); return; } catch {}
        // Replace only the generated Python environment; account profiles stay in place.
        fs.renameSync(VENV_DIR, path.join(CAMOUFOX_RUNTIME_ROOT, 'venv-backup-' + Date.now()));
      });
    }
    if (!fs.existsSync(VENV_PYTHON)) {
      await setupStep('runtime', 'Подготавливаем Python-окружение браузера…', () => run(python.command, [...python.prefix, '-m', 'venv', VENV_DIR], { timeoutMs: 2 * 60_000 }));
    }
    const runtimePython = await setupStep('runtime', 'Проверяем окружение браузера…', async () => {
      const python = await getRuntimePython();
      try { await run(python, ['-m', 'pip', '--version'], { timeoutMs: 30_000 }); }
      catch { await run(python, ['-m', 'ensurepip', '--upgrade'], { timeoutMs: 120_000 }); }
      return python;
    });
    await setupStep('package', 'Устанавливаем Camoufox. При первом входе это может занять несколько минут…', () => run(runtimePython, [
      "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
      `camoufox==${CAMOUFOX_PACKAGE_VERSION}`,
    ], { timeoutMs: 180_000 }));
    await setupStep('browser', 'Скачиваем браузер Camoufox (один раз). Дождитесь завершения загрузки…', () => run(runtimePython, ['-m', 'camoufox', 'fetch'], { timeoutMs: 300_000 }));
    installState = { phase: "ready", message: `Camoufox ${CAMOUFOX_PACKAGE_VERSION} готов` };
    return runtimePython;
  })().catch((error) => {
    installState = { phase: "error", message: error.userMessage || error.message, code: error.code };
    throw error;
  }).finally(() => {
    installPromise = null;
  });
  return installPromise;
}

export async function launchCamoufoxSession({
  viewport = { width: 580, height: 900 },
  storageStatePath = CAMOUFOX_STORAGE_STATE,
  fingerprintStatePath = null,
  profileDir = null,
  headless = true,
} = {}) {
  if (!headless && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    const message = 'Нельзя открыть окно входа: в этой Linux/WSL/SSH-среде нет графического экрана. Используйте локальное окно IDE или настройте графическую среду (WSLg/X11).';
    throw Object.assign(new Error(message), { code: 'CAMOUFOX_DISPLAY_REQUIRED', userMessage: message, delivery: 'not_sent' });
  }
  await ensureCamoufoxInstalled();
  const python = await getRuntimePython();
  const configPath = path.join(os.tmpdir(), `ai-free-camoufox-${process.pid}-${Date.now()}.json`);
  let raw;
  try {
    await run(python, ["-c", CAMOUFOX_CONFIG_CODE, configPath, headless ? "1" : "0", fingerprintStatePath || ""], { timeoutMs: 45_000 });
    raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    saveCamoufoxFingerprint(raw, fingerprintStatePath);
  } catch (cause) {
    throw browserSetupError('launch', cause);
  } finally {
    try { fs.unlinkSync(configPath); } catch {}
  }
  const { firefox } = await import("playwright");
  const launchOptions = {
    executablePath: raw.executable_path,
    args: raw.args,
    env: raw.env,
    firefoxUserPrefs: raw.firefox_user_prefs,
    headless: raw.headless,
  };
  const contextOptions = buildCamoufoxContextOptions({ viewport, storageStatePath: profileDir ? null : storageStatePath });
  const initialStorageState = readInitialStorageState(profileDir, storageStatePath);
  if (profileDir) fs.mkdirSync(profileDir, { recursive: true });
  let browser = null, context;
  try {
    browser = profileDir ? null : await firefox.launch(launchOptions);
    context = profileDir
      ? await firefox.launchPersistentContext(profileDir, { ...launchOptions, ...contextOptions })
      : await browser.newContext(contextOptions);
  } catch (cause) {
    await browser?.close().catch(() => {});
    throw browserSetupError('launch', cause);
  }
  try {
    await restoreInitialStorageState(context, initialStorageState);
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
  const page = await context.newPage();
  let closed = false;
  let closing = false, closePromise = null, checkpointPromise = null;
  const bounded = async (work, timeoutMs) => {
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
        timer = setTimeout(() => {
          const message = 'Не удалось завершить закрытие браузера аккаунта. Перезапустите SYNVOX и повторите подключение. Сохранённые данные входа не удалены.';
          reject(Object.assign(new Error(message), { code: 'CAMOUFOX_CLOSE_TIMEOUT', userMessage: message }));
        }, timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  };
  const persistStorageState = () => {
    if (closed || closing) return Promise.resolve();
    if (checkpointPromise) return checkpointPromise;
    checkpointPromise = (async () => {
      try {
        const state = await bounded(() => context.storageState(), 5000);
        writeAtomicJsonSync(storageStatePath, state);
      } catch {
        // Keep the previous snapshot if the page is stuck or already gone.
        console.warn('[camoufox] Снимок сессии не обновлён; сохранён предыдущий.');
      } finally { checkpointPromise = null; }
    })();
    return checkpointPromise;
  };
  const checkpointTimer = setInterval(() => {
    persistStorageState().catch(() => {});
  }, 30_000);
  checkpointTimer.unref?.();
  const close = () => {
    if (closed) return Promise.resolve();
    if (closePromise) return closePromise;
    clearInterval(checkpointTimer);
    const finalSnapshot = persistStorageState();
    closing = true;
    closePromise = (async () => {
      await finalSnapshot;
      const ownedBrowser = browser || context.browser?.();
      try { await bounded(() => context.close(), 5000); }
      catch (error) { if (!ownedBrowser) throw error; }
      if (ownedBrowser) await bounded(() => ownedBrowser.close(), 35_000);
      closed = true;
    })().catch(error => {
      closing = false;
      closePromise = null;
      throw error;
    });
    return closePromise;
  };
  return { browser, context, page, close, persistStorageState, mode: "camoufox" };
}
