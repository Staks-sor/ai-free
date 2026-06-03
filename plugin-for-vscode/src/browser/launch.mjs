// Запуск Chromium через Playwright + открытие окна чатов на хосте.
// Здесь нет логики авторизации — только «как поднять браузер» и «как открыть URL».

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawn, spawnSync } from "node:child_process";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");

function shouldInstallPlaywrightBrowser(error) {
  const message = String(error?.message || "");
  return /Executable doesn't exist|browserType\.launch|playwright install/i.test(message);
}

function installPlaywrightChromium() {
  const cli = path.join(projectRoot, "node_modules", "playwright", "cli.js");
  if (!fs.existsSync(cli)) return false;
  console.log("[playwright] Chromium browser is missing. Installing it now...");
  const result = spawnSync(process.execPath, [cli, "install", "chromium"], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
  return result.status === 0;
}

// Поднять persistent Chromium-профиль для DeepSeek. headless=false — видимое окно,
// true — для тихого refresh из профиля. Чистит stale SingletonLock-файлы от падений.
export async function launchPersistentDeepSeekContext(chromium, profileDir, headless) {
  fs.mkdirSync(profileDir, { recursive: true });
  const options = {
    headless,
    viewport: null,
    args: ["--disable-blink-features=AutomationControlled"],
  };

  const tryLaunch = async () => {
    try {
      return await chromium.launchPersistentContext(profileDir, {
        ...options,
        channel: "chrome",
      });
    } catch (chromeError) {
      try {
        return await chromium.launchPersistentContext(profileDir, options);
      } catch (chromiumError) {
        const combined = new Error(
          `Chrome error: ${chromeError.message}. Chromium error: ${chromiumError.message}`,
        );
        combined.bothFailed = true;
        throw combined;
      }
    }
  };

  try {
    return await tryLaunch();
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("ProcessSingleton") || message.includes("SingletonLock")) {
      // Stale-локи от прошлого упавшего Chromium-инстанса.
      for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
        try { fs.unlinkSync(path.join(profileDir, f)); } catch {}
      }
      try {
        return await tryLaunch();
      } catch (retryError) {
        throw new Error(
          `Could not open browser profile even after clearing stale lock files. ${retryError.message}`,
        );
      }
    }
    if (shouldInstallPlaywrightBrowser(error) && installPlaywrightChromium()) {
      try {
        return await tryLaunch();
      } catch (retryError) {
        throw new Error(`Could not open browser profile after installing Chromium. ${retryError.message}`);
      }
    }
    throw new Error(`Could not open browser profile. ${error.message}`);
  }
}

// Открыть URL в новом окне-приложении. На macOS — через `open -na "Google Chrome" --app=`.
// На Win/Linux — сами ищем chrome.exe / google-chrome и запускаем с --app.
// Fallback: дефолтный браузер обычной вкладкой.
export function openAppWindow(url) {
  if (process.platform === "darwin") {
    const chrome = spawn("open", ["-na", "Google Chrome", "--args", `--app=${url}`], {
      detached: true,
      stdio: "ignore",
    });
    chrome.on("error", () => {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    });
    chrome.unref();
    return;
  }

  const chromeBinary = findChromeBinary();
  if (chromeBinary) {
    try {
      const proc = spawn(chromeBinary, [`--app=${url}`, "--new-window"], {
        detached: true,
        stdio: "ignore",
      });
      proc.on("error", () => fallbackOpen(url));
      proc.unref();
      return;
    } catch {
      // fall through
    }
  }

  fallbackOpen(url);
}

// Поиск Chrome/Chromium/Edge на Win/Linux. Возвращает абсолютный путь или null.
// Порядок: настоящий Chrome → Chromium → Edge.
export function findChromeBinary() {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const candidates = [
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      localAppData ? path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe") : null,
      path.join(programFiles, "Chromium", "Application", "chrome.exe"),
      path.join(programFilesX86, "Chromium", "Application", "chrome.exe"),
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    ].filter(Boolean);
    for (const candidate of candidates) {
      try { if (fs.existsSync(candidate)) return candidate; } catch {}
    }
    return null;
  }

  const names = [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "microsoft-edge-stable",
  ];
  for (const name of names) {
    try {
      const result = spawnSync("which", [name], { encoding: "utf8" });
      if (result.status === 0 && result.stdout) {
        const found = result.stdout.split("\n")[0].trim();
        if (found && fs.existsSync(found)) return found;
      }
    } catch {}
  }
  return null;
}

export function fallbackOpen(url) {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}
