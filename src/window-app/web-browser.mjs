// Лёгкий headless Chromium для вкладки Web (DeepSeek/Qwen). Отдельно от Chrome ChatGPT.

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { launchPersistentDeepSeekContext } from "../browser/launch.mjs";
import { rewriteBlockedSearchUrl } from "../browser/search-engine.mjs";
import { createLiveViewportState } from "./live-viewport.mjs";
import { buildWebBrowserStartDataUrl } from "./web-start.mjs";

export const WEB_BROWSER_PROFILE = path.join(os.homedir(), ".deepseek-cli", "web-browser-profile");
export const WEB_BROWSER_DEFAULT_VIEWPORT = { width: 960, height: 720 };

const WEB_BROWSER_PERF_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-sync",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--mute-audio",
  "--hide-scrollbars",
  "--no-first-run",
];

const webLiveViewport = createLiveViewportState(WEB_BROWSER_DEFAULT_VIEWPORT);

/** @type {Promise<import("playwright-core").BrowserContext> | null} */
let contextPromise = null;
/** @type {import("playwright-core").Page | null} */
let pageRef = null;
/** @type {{ width: number, height: number } | null} */
let appliedViewport = null;

export function getWebBrowserViewport() {
  return webLiveViewport.get();
}

async function applyViewportIfNeeded(page) {
  const next = getWebBrowserViewport();
  if (
    appliedViewport
    && appliedViewport.width === next.width
    && appliedViewport.height === next.height
  ) {
    return;
  }
  await page.setViewportSize(next);
  appliedViewport = { ...next };
}

export async function setWebBrowserViewport(body = {}) {
  const prev = webLiveViewport.get();
  const next = webLiveViewport.set(body.width, body.height);
  if (prev.width === next.width && prev.height === next.height) {
    return { ok: true, ...next, unchanged: true };
  }
  appliedViewport = null;
  try {
    const page = await getWebBrowserPage();
    await applyViewportIfNeeded(page);
  } catch {}
  return { ok: true, ...next };
}

async function installPerfInitScripts(context) {
  try {
    await context.addInitScript(() => {
      try {
        const style = document.createElement("style");
        style.textContent = [
          "*,*::before,*::after{animation-duration:0.001ms!important;animation-iteration-count:1!important;",
          "transition-duration:0.001ms!important;scroll-behavior:auto!important}",
        ].join("");
        (document.documentElement || document.head || document.body)?.appendChild(style);
      } catch {}
    });
  } catch {}
}

async function installSearchNavigationGuard(context) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (!request.isNavigationRequest() || request.resourceType() !== "document") {
      await route.continue();
      return;
    }

    const rewritten = rewriteBlockedSearchUrl(request.url());
    if (!rewritten.rewritten) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 302,
      headers: {
        location: rewritten.url,
        "cache-control": "no-store",
      },
      body: "",
    });
  });
}

async function launchWebBrowserContext() {
  const { ensureBrowserBinaries } = await import("../browser/ensure-binaries.mjs");
  await ensureBrowserBinaries();
  const { getChatGPTChromium } = await import("../providers/chatgpt/engine.mjs");
  const chromium = await getChatGPTChromium();
  const viewport = getWebBrowserViewport();
  const context = await launchPersistentDeepSeekContext(chromium, WEB_BROWSER_PROFILE, true, {
    channel: "",
    viewport,
    reducedMotion: "reduce",
    args: WEB_BROWSER_PERF_ARGS,
  });
  await installPerfInitScripts(context);
  await installSearchNavigationGuard(context);
  context.on("close", () => {
    contextPromise = null;
    pageRef = null;
    appliedViewport = null;
  });
  return context;
}

async function ensureWebBrowserStartPage(page) {
  const url = String(page.url() || "");
  if (!url || url === "about:blank") {
    await page.goto(buildWebBrowserStartDataUrl(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  }
}

export async function getWebBrowserPage() {
  if (!contextPromise) {
    contextPromise = launchWebBrowserContext();
  }
  const context = await contextPromise;
  if (!pageRef || pageRef.isClosed()) {
    pageRef = context.pages()[0] || await context.newPage();
    appliedViewport = null;
  }
  await applyViewportIfNeeded(pageRef);
  await ensureWebBrowserStartPage(pageRef);
  return pageRef;
}

export function setWebBrowserActivePage(page) {
  if (!page || page.isClosed?.()) return;
  pageRef = page;
  appliedViewport = null;
}

export function getWebBrowserContextPromise() {
  return contextPromise;
}

export async function captureWebBrowserJpeg(page) {
  return page.screenshot({
    type: "jpeg",
    quality: 50,
    timeout: 8000,
    animations: "disabled",
  });
}

export async function warmWebBrowser() {
  const page = await getWebBrowserPage();
  return { ok: true, url: page.url() };
}

export async function resetWebBrowser() {
  appliedViewport = null;
  if (contextPromise) {
    try {
      const context = await contextPromise;
      await context.close();
    } catch {}
  }
  contextPromise = null;
  pageRef = null;
  cleanupWebBrowserProfileLocks();
  return { ok: true, engine: "patchright-headless" };
}

function cleanupWebBrowserProfileLocks() {
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      fs.unlinkSync(path.join(WEB_BROWSER_PROFILE, name));
    } catch {}
  }
}

export async function closeWebBrowser() {
  await resetWebBrowser();
}
