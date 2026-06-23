// Окно приложения ai-free (http://127.0.0.1:4317) — Playwright/Patchright, свой профиль.
// Не spawn(Google Chrome) с --user-data-dir — иначе «Не удалось открыть профиль».

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { killStaleChromeForProfile } from "../providers/chatgpt/browser-login.mjs";
import { getChatGPTChromium } from "../providers/chatgpt/engine.mjs";

export const APP_WINDOW_PROFILE = path.join(os.homedir(), ".deepseek-cli", "app-window-profile");
const OPEN_TIMEOUT_MS = Number(process.env.AI_FREE_WINDOW_TIMEOUT_MS || 25_000);

let shellPromise = null;

function cleanupProfileLocks(profileDir) {
  for (const file of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try { fs.unlinkSync(path.join(profileDir, file)); } catch {}
  }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} (${ms}ms)`)), ms);
    }),
  ]);
}

async function launchShellContext(chromium, appUrl) {
  killStaleChromeForProfile(APP_WINDOW_PROFILE);
  fs.mkdirSync(APP_WINDOW_PROFILE, { recursive: true });
  cleanupProfileLocks(APP_WINDOW_PROFILE);

  const launchOptions = {
    headless: false,
    // null — viewport следует за размером окна, без чёрных «пропусков» при resize.
    viewport: null,
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      `--app=${appUrl}`,
      "--window-size=1320,860",
    ],
  };

  const embedUi = process.env.CHATGPT_EMBED_IN_UI === "1";

  // Одно окно приложения — только bundled Patchright/Chromium, без fallback на Google Chrome.
  if (embedUi) {
    return await chromium.launchPersistentContext(APP_WINDOW_PROFILE, launchOptions);
  }

  try {
    return await chromium.launchPersistentContext(APP_WINDOW_PROFILE, launchOptions);
  } catch (bundledError) {
    cleanupProfileLocks(APP_WINDOW_PROFILE);
    try {
      return await chromium.launchPersistentContext(APP_WINDOW_PROFILE, {
        ...launchOptions,
        channel: "chrome",
      });
    } catch {
      throw bundledError;
    }
  }
}

export async function openAppWindowInternal(url) {
  const { ensureBrowserBinaries } = await import("../browser/ensure-binaries.mjs");
  await ensureBrowserBinaries();

  if (shellPromise) {
    try {
      const context = await shellPromise;
      const page = context.pages()[0] || (await context.newPage());
      if (!page.url().startsWith(url.replace(/\/$/, ""))) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      }
      await page.bringToFront?.().catch(() => {});
      return context;
    } catch {
      shellPromise = null;
    }
  }

  shellPromise = withTimeout((async () => {
    const chromium = await getChatGPTChromium();
    const context = await launchShellContext(chromium, url);
    const page = context.pages()[0] || (await context.newPage());
    if (!page.url().startsWith(url.replace(/\/$/, ""))) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
    context.on("close", () => {
      shellPromise = null;
    });
    return context;
  })(), OPEN_TIMEOUT_MS, "Открытие окна ai-free").catch((error) => {
    shellPromise = null;
    throw error;
  });

  return shellPromise;
}

export async function closeAppWindowShell() {
  if (!shellPromise) return;
  try {
    const context = await shellPromise;
    await context.close().catch(() => {});
  } catch {}
  shellPromise = null;
}
