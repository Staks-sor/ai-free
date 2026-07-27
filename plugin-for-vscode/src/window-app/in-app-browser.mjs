// Встроенный браузер AI Free: Camoufox без отдельного окна, UI передаётся через MJPEG.
// Если runtime недоступен, используется bundled Chromium, но не системный Google Chrome.

import os from "node:os";
import path from "node:path";
import { CHATGPT_BASE_URL, CHATGPT_BROWSER_PROFILE } from "../providers/chatgpt/config.mjs";
import { launchCamoufoxSession } from "../browser/camoufox-runtime.mjs";
import { getChatGPTChromium } from "../providers/chatgpt/engine.mjs";

export const IN_APP_BROWSER_PROFILE = CHATGPT_BROWSER_PROFILE;
export const IN_APP_BROWSER_FALLBACK_PROFILE = path.join(os.homedir(), ".deepseek-cli", "internal-browser-profile");
export const IN_APP_BROWSER_VIEWPORT = { width: 580, height: 900 };

const SLOT_PAGES = new Map();
/** @type {Promise<{ context, page, close, mode }> | null} */
let sessionPromise = null;
/** @type {Promise<{ context, page, close, mode }> | null} */
let launchingPromise = null;
let launchLabel = "camoufox";

function preferCamoufox() {
  return String(process.env.AI_FREE_BROWSER_ENGINE || "camoufox").toLowerCase() !== "chromium";
}

async function launchBundledChromiumSession() {
  const { ensureBrowserBinaries } = await import("../browser/ensure-binaries.mjs");
  await ensureBrowserBinaries();
  const chromium = await getChatGPTChromium();
  const context = await chromium.launchPersistentContext(IN_APP_BROWSER_FALLBACK_PROFILE, {
    headless: true,
    viewport: IN_APP_BROWSER_VIEWPORT,
    locale: "ru-RU",
    reducedMotion: "reduce",
  });
  const page = context.pages()[0] || await context.newPage();
  return {
    context,
    page,
    close: () => context.close(),
    mode: "bundled-chromium",
  };
}

async function launchInternalSession() {
  if (preferCamoufox()) {
    try {
      const session = await launchCamoufoxSession({ viewport: IN_APP_BROWSER_VIEWPORT });
      launchLabel = session.mode;
      return session;
    } catch (error) {
      console.warn(`[in-app-browser] Camoufox unavailable, using bundled Chromium: ${error.message}`);
    }
  }
  const session = await launchBundledChromiumSession();
  launchLabel = session.mode;
  return session;
}

async function ensureInternalSession() {
  if (sessionPromise) {
    try {
      const session = await sessionPromise;
      const page = session.page;
      if (page && !page.isClosed?.()) {
        return session;
      } else {
        sessionPromise = null;
      }
    } catch {
      sessionPromise = null;
    }
  }

  if (!launchingPromise) {
    launchingPromise = launchInternalSession()
      .then((session) => {
        sessionPromise = Promise.resolve(session);
        return session;
      })
      .catch((error) => {
        sessionPromise = null;
        throw error;
      })
      .finally(() => {
        launchingPromise = null;
      });
  }

  return launchingPromise;
}

export function getInAppBrowserLaunchLabel() {
  return launchLabel;
}

export function isInAppBrowserHeadless() {
  return true;
}

export async function getInAppBrowserContext() {
  const session = await ensureInternalSession();
  return session.context;
}

async function resolveSlotPage(slot) {
  const key = String(slot || "web");
  const cached = SLOT_PAGES.get(key);
  if (cached && !cached.isClosed?.()) {
    await cached.setViewportSize(IN_APP_BROWSER_VIEWPORT);
    return cached;
  }

  const session = await ensureInternalSession();
  const { context } = session;

  if (key === "chatgpt") {
    let page = context.pages().find((p) => !p.isClosed?.() && /chatgpt\.com/i.test(p.url()));
    if (!page) {
      page = session.page;
      if (!/chatgpt\.com/i.test(page.url())) {
        await page.goto(`${CHATGPT_BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      }
    }
    await page.setViewportSize(IN_APP_BROWSER_VIEWPORT);
    SLOT_PAGES.set(key, page);
    return page;
  }

  let page = SLOT_PAGES.get(key);
  if (!page || page.isClosed?.()) {
    page = await context.newPage();
  }
  await page.setViewportSize(IN_APP_BROWSER_VIEWPORT);
  SLOT_PAGES.set(key, page);
  return page;
}

export async function getInAppBrowserPage(slot = "web") {
  return resolveSlotPage(slot);
}

export async function closeInAppBrowser() {
  const pending = sessionPromise || launchingPromise;
  sessionPromise = null;
  launchingPromise = null;
  SLOT_PAGES.clear();
  if (!pending) return;
  try {
    const session = await pending;
    await session.close?.();
  } catch {}
}

export async function resetInAppBrowser() {
  await closeInAppBrowser();
  await ensureInternalSession();
  return { ok: true, engine: getInAppBrowserLaunchLabel() };
}

export async function attachInAppBrowserSession(slot = "chatgpt") {
  const session = await ensureInternalSession();
  const page = await resolveSlotPage(slot);
  return {
    context: session.context,
    page,
    close: async () => {},
    mode: session.mode,
  };
}
