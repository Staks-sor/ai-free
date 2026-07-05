// In-app браузер AI Free = настоящий Google Chrome (spawn + CDP), не Patchright persistent.
// Окно Chrome скрыто за экраном; пользователь видит MJPEG в 🧠 → Браузер.

import { CHATGPT_BASE_URL, CHATGPT_BROWSER_PROFILE } from "../providers/chatgpt/config.mjs";
import {
  ensureChatGPTProfileReady,
  isChromeProfileErrorPage,
  launchNormalChromeForChatGPT,
  prepareChromeProfileForLaunch,
  resetChatGPTProfileReady,
} from "../providers/chatgpt/browser-login.mjs";
import { getChatGPTChromium } from "../providers/chatgpt/engine.mjs";

export const IN_APP_BROWSER_PROFILE = CHATGPT_BROWSER_PROFILE;
export const IN_APP_BROWSER_VIEWPORT = { width: 580, height: 900 };

const SLOT_PAGES = new Map();
/** @type {Promise<{ context, page, close, mode }> | null} */
let sessionPromise = null;
/** @type {Promise<{ context, page, close, mode }> | null} */
let launchingPromise = null;
let launchLabel = "google-chrome-cdp";

function useHeadlessChrome() {
  return process.env.CHATGPT_EMBED_HEADED === "0";
}

async function launchChromeSession() {
  await ensureChatGPTProfileReady(IN_APP_BROWSER_PROFILE);

  const { ensureBrowserBinaries } = await import("../browser/ensure-binaries.mjs");
  await ensureBrowserBinaries();

  const chromium = await getChatGPTChromium();
  const headless = useHeadlessChrome();
  const launchOpts = {
    initialUrl: `${CHATGPT_BASE_URL}/`,
    clearCookies: false,
    headless,
    embedded: true,
    offscreen: !headless,
    skipKillStale: true,
    windowSize: IN_APP_BROWSER_VIEWPORT,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await prepareChromeProfileForLaunch(IN_APP_BROWSER_PROFILE, { clearCookies: false });
    }

    const session = await launchNormalChromeForChatGPT(chromium, IN_APP_BROWSER_PROFILE, launchOpts);
    if (!session) continue;

    if (await isChromeProfileErrorPage(session.page, session.context)) {
      try { await session.close(); } catch {}
      continue;
    }

    launchLabel = session.mode === "chrome-cdp-embedded" ? "google-chrome-cdp" : String(session.mode);
    return session;
  }

  throw new Error(
    "Chrome не запустился (профиль занят). Нажмите «Сброс» в панели или выполните: pkill -9 -f user-data-dir=.chatgpt-cli",
  );
}

async function ensureChromeSession() {
  if (sessionPromise) {
    try {
      const session = await sessionPromise;
      const page = session.page;
      if (page && !page.isClosed?.()) {
        if (await isChromeProfileErrorPage(page, session.context)) {
          try { await session.close(); } catch {}
          sessionPromise = null;
        } else {
          return session;
        }
      } else {
        sessionPromise = null;
      }
    } catch {
      sessionPromise = null;
    }
  }

  if (!launchingPromise) {
    launchingPromise = launchChromeSession()
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
  return useHeadlessChrome();
}

export async function getInAppBrowserContext() {
  const session = await ensureChromeSession();
  return session.context;
}

async function resolveSlotPage(slot) {
  const key = String(slot || "web");
  const cached = SLOT_PAGES.get(key);
  if (cached && !cached.isClosed?.()) {
    await cached.setViewportSize(IN_APP_BROWSER_VIEWPORT);
    return cached;
  }

  const session = await ensureChromeSession();
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
  const pending = sessionPromise;
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
  resetChatGPTProfileReady();
  await prepareChromeProfileForLaunch(IN_APP_BROWSER_PROFILE, { clearCookies: false });
  await ensureChromeSession();
  return { ok: true, engine: getInAppBrowserLaunchLabel() };
}

export async function attachInAppBrowserSession(slot = "chatgpt") {
  const session = await ensureChromeSession();
  const page = await resolveSlotPage(slot);
  return {
    context: session.context,
    page,
    close: async () => {},
    mode: "chrome-cdp",
  };
}
