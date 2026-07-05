// Единый BrowserService: Playwright Web-контекст, snapshot v2, actions, MCP/code-agent API.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  buildPageSnapshotScript,
  formatSnapshotForPrompt,
  formatSnapshotForToolLog,
  SNAPSHOT_FORMAT,
} from "./snapshot-build.mjs";
import {
  buildBlockedSearchFallback,
  rewriteBlockedSearchUrl,
  detectSearchBlockHint,
} from "./search-engine.mjs";

export { SNAPSHOT_FORMAT, formatSnapshotForPrompt, formatSnapshotForToolLog };

const SNAPSHOT_CACHE_DIR = path.join(os.homedir(), ".deepseek-cli", "browser-cache");
const LAST_SCREENSHOT = path.join(SNAPSHOT_CACHE_DIR, "last-snapshot.jpg");

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function readPageMeta(page) {
  const url = page.url();
  const title = await page.title().catch(() => "");
  let bodyText = "";
  try {
    bodyText = await page.locator("body").innerText({ timeout: 2500 });
  } catch {}
  const captchaHint = detectSearchBlockHint({ url, title, text: bodyText });
  return {
    url,
    title,
    ...(captchaHint ? { captchaHint } : {}),
  };
}

export async function browserRecoverBlockedSearch(pageOverride = null) {
  const page = pageOverride || await getPage();
  const meta = await readPageMeta(page);
  if (!meta.captchaHint) return { recovered: false, ...meta };
  const fallback = buildBlockedSearchFallback(meta.url);
  if (!fallback) return { recovered: false, ...meta };

  await page.goto(fallback.url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(120);
  return {
    recovered: true,
    reason: "google-captcha",
    query: fallback.query,
    engineId: fallback.engineId,
    originalUrl: fallback.originalUrl,
    ...(await readPageMeta(page)),
    hint: "Google запросил CAPTCHA, поэтому поиск автоматически открыт в другом поисковике.",
  };
}

export function validateBrowserUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("URL должен начинаться с http:// или https://");
  }
  return url;
}

async function getPage() {
  const { getWebBrowserPage } = await import("../window-app/web-browser.mjs");
  return getWebBrowserPage();
}

async function getViewport() {
  const { getWebBrowserViewport } = await import("../window-app/web-browser.mjs");
  return getWebBrowserViewport();
}

function clampCoord(value, max) {
  return Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
}

async function saveScreenshotBuffer(buf) {
  fs.mkdirSync(SNAPSHOT_CACHE_DIR, { recursive: true });
  fs.writeFileSync(LAST_SCREENSHOT, buf);
  return {
    path: LAST_SCREENSHOT,
    bytes: buf.length,
    mime: "image/jpeg",
  };
}

export async function browserWarm() {
  const page = await getPage();
  return { ok: true, url: page.url() };
}

export async function browserReset() {
  const { resetWebBrowser } = await import("../window-app/web-browser.mjs");
  await resetWebBrowser();
  const page = await getPage();
  return {
    ok: true,
    url: page.url(),
    hint: "Web-браузер перезапущен. Профиль ~/.deepseek-cli/web-browser-profile сохранён.",
  };
}

export async function browserNavigate(rawUrl, { waitUntil = "domcontentloaded" } = {}) {
  const validated = validateBrowserUrl(rawUrl);
  const { url, rewritten, reason, originalUrl, engineId } = rewriteBlockedSearchUrl(validated);
  const page = await getPage();
  await page.goto(url, { waitUntil, timeout: 90_000 });
  await page.waitForTimeout(120);
  const recovery = await browserRecoverBlockedSearch(page);
  const meta = recovery.recovered ? recovery : await readPageMeta(page);
  return {
    ok: true,
    ...meta,
    ...(rewritten
      ? {
          rewritten: true,
          reason,
          originalUrl,
          engineId,
          hint: "Google search перенаправлен — headless Google часто даёт captcha.",
        }
      : {}),
  };
}

export async function browserGoBack() {
  const page = await getPage();
  await page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(120);
  const meta = await readPageMeta(page);
  return { ok: true, ...meta };
}

export async function browserWait({ ms, until } = {}) {
  const page = await getPage();
  const waitMs = clampInt(ms, 0, 60_000, 0);
  if (until === "load") {
    await page.waitForLoadState("load", { timeout: Math.max(waitMs, 15_000) }).catch(() => {});
  } else if (until === "networkidle") {
    await page.waitForLoadState("networkidle", { timeout: Math.max(waitMs, 15_000) }).catch(() => {});
  } else if (waitMs > 0) {
    await page.waitForTimeout(waitMs);
  }
  const meta = await readPageMeta(page);
  return { ok: true, waitedMs: waitMs, until: until || "timeout", ...meta };
}

export async function browserScroll({ deltaY = 400, x, y, ref } = {}) {
  const page = await getPage();
  const { width: vw, height: vh } = await getViewport();
  const dy = Number(deltaY) || 400;

  if (ref) {
    const locator = page.locator(`[data-ai-free-ref="${String(ref).trim()}"]`).first();
    await locator.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(60);
  }

  const cx = Number.isFinite(Number(x)) ? clampCoord(x, vw) : Math.round(vw / 2);
  const cy = Number.isFinite(Number(y)) ? clampCoord(y, vh) : Math.round(vh / 2);
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(80);
  const meta = await readPageMeta(page);
  return { ok: true, deltaY: dy, ...meta };
}

async function resolveRefLocator(page, ref) {
  const id = String(ref || "").trim();
  if (!/^e\d+$/i.test(id)) {
    throw new Error(`Invalid ref "${ref}". Use refs from browser_snapshot (e.g. e3).`);
  }
  const locator = page.locator(`[data-ai-free-ref="${id}"]`).first();
  const count = await locator.count();
  if (!count) {
    throw new Error(`Ref "${id}" not found. Call browser_snapshot again — page may have changed.`);
  }
  return locator;
}

export async function browserClick({ ref, text, selector, x, y } = {}) {
  const page = await getPage();
  const { width: vw, height: vh } = await getViewport();
  const refId = String(ref || "").trim();
  const label = String(text || "").trim();
  const sel = String(selector || "").trim();

  if (refId) {
    await (await resolveRefLocator(page, refId)).click({ timeout: 15_000 });
  } else if (sel) {
    await page.locator(sel).first().click({ timeout: 15_000 });
  } else if (label) {
    const button = page.getByRole("button", { name: label });
    if (await button.count()) {
      await button.first().click({ timeout: 15_000 });
    } else {
      const link = page.getByRole("link", { name: label });
      if (await link.count()) {
        await link.first().click({ timeout: 15_000 });
      } else {
        await page.getByText(label, { exact: false }).first().click({ timeout: 15_000 });
      }
    }
  } else if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
    const cx = clampCoord(x, vw);
    const cy = clampCoord(y, vh);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.up();
  } else {
    throw new Error('browser_click requires "ref", "text", "selector", or numeric "x"+"y".');
  }

  await page.waitForTimeout(120);
  const meta = await readPageMeta(page);
  return { ok: true, ...meta };
}

export async function browserType({ text, ref, clear = false } = {}) {
  const page = await getPage();
  const value = String(text ?? "");
  const refId = String(ref || "").trim();

  if (refId) {
    const locator = await resolveRefLocator(page, refId);
    const tag = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
    if (tag === "input" || tag === "textarea" || tag === "select") {
      if (clear) await locator.fill("");
      await locator.fill(value);
    } else {
      await locator.click({ timeout: 10_000 });
      if (clear) {
        await page.keyboard.press("Meta+A").catch(() => page.keyboard.press("Control+A"));
        await page.keyboard.press("Backspace");
      }
      await page.keyboard.insertText(value);
    }
  } else {
    await page.keyboard.insertText(value);
  }

  await page.waitForTimeout(80);
  const meta = await readPageMeta(page);
  return { ok: true, ...meta };
}

export async function browserPressKey(key) {
  const page = await getPage();
  const name = String(key || "Enter").trim() || "Enter";
  await page.keyboard.press(name);
  await page.waitForTimeout(100);
  const meta = await readPageMeta(page);
  return { ok: true, key: name, ...meta };
}

export async function browserListTabs() {
  const page = await getPage();
  const context = page.context();
  const tabs = context.pages().filter((p) => !p.isClosed()).map((p, index) => ({
    index,
    url: p.url(),
    active: p === page,
  }));
  return { ok: true, tabs };
}

export async function browserSwitchTab(index) {
  const page = await getPage();
  const context = page.context();
  const pages = context.pages().filter((p) => !p.isClosed());
  const idx = clampInt(index, 0, Math.max(0, pages.length - 1), 0);
  const target = pages[idx];
  if (!target) throw new Error("No browser tab at index " + index);
  const { setWebBrowserActivePage } = await import("../window-app/web-browser.mjs");
  setWebBrowserActivePage(target);
  await target.bringToFront().catch(() => {});
  await target.waitForTimeout(80);
  return { ok: true, index: idx, url: target.url(), title: await target.title().catch(() => "") };
}

export async function browserSnapshot({
  maxTextChars = 8000,
  maxRefs = 80,
  includeScreenshot = true,
  includeScreenshotBase64 = false,
  screenshotQuality = 55,
} = {}) {
  const page = await getPage();
  const script = buildPageSnapshotScript(maxTextChars, maxRefs);

  let data = {
    format: SNAPSHOT_FORMAT,
    url: page.url(),
    title: "",
    text: "",
    tree: "",
    refs: [],
    truncated: false,
  };

  try {
    data = await page.evaluate(script, {
      maxTextChars: clampInt(maxTextChars, 500, 20000, 8000),
      maxRefs: clampInt(maxRefs, 10, 120, 80),
    });
  } catch (error) {
    return {
      ok: false,
      empty: true,
      error: error.message,
      format: SNAPSHOT_FORMAT,
      url: page.url(),
      title: "",
      text: "",
      tree: "",
      refs: [],
    };
  }

  const empty = !data.text && (!data.refs?.length) && (data.url === "about:blank" || !data.url);
  const result = {
    ok: true,
    empty,
    format: data.format || SNAPSHOT_FORMAT,
    url: data.url,
    title: data.title,
    text: data.text,
    truncated: Boolean(data.truncated),
    tree: data.tree,
    refs: Array.isArray(data.refs) ? data.refs : [],
    interactives: Array.isArray(data.refs)
      ? data.refs.map((r) => ({
        ref: r.ref,
        label: r.name,
        role: r.role,
        tag: r.tag,
        x: null,
        y: null,
      }))
      : [],
  };

  if (includeScreenshot) {
    try {
      const { captureWebBrowserJpeg } = await import("../window-app/web-browser.mjs");
      const buf = await captureWebBrowserJpeg(page);
      result.screenshot = await saveScreenshotBuffer(buf);
      if (includeScreenshotBase64 && buf.length < 900_000) {
        result.screenshot.base64 = buf.toString("base64");
      }
    } catch (error) {
      result.screenshotError = error.message;
    }
  }

  return result;
}

/** Диспетчер tool-call (code-agent + MCP). */
export async function executeBrowserTool(call = {}) {
  const tool = String(call.tool || call.name || "").trim();
  switch (tool) {
    case "browser_snapshot":
      return browserSnapshot({
        maxTextChars: call.maxTextChars,
        maxRefs: call.maxRefs,
        includeScreenshot: call.includeScreenshot !== false,
        includeScreenshotBase64: call.includeScreenshotBase64 === true,
        screenshotQuality: call.screenshotQuality,
      });
    case "browser_navigate":
      return browserNavigate(call.url, { waitUntil: call.waitUntil });
    case "browser_click":
      return browserClick(call);
    case "browser_type":
      return browserType(call);
    case "browser_key":
    case "browser_press_key":
      return browserPressKey(call.key);
    case "browser_scroll":
      return browserScroll(call);
    case "browser_wait":
      return browserWait(call);
    case "browser_go_back":
      return browserGoBack();
    case "browser_list_tabs":
      return browserListTabs();
    case "browser_switch_tab":
      return browserSwitchTab(call.index ?? call.tab ?? 0);
    case "browser_reset":
      return browserReset();
    default:
      throw new Error(`Unknown browser tool: ${tool || "(empty)"}`);
  }
}

export const BROWSER_TOOL_NAMES = [
  "browser_snapshot",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_key",
  "browser_scroll",
  "browser_wait",
  "browser_go_back",
  "browser_list_tabs",
  "browser_switch_tab",
  "browser_reset",
];

export function getBrowserMcpToolDefinitions() {
  return BROWSER_TOOL_NAMES.map((name) => {
    const schemas = {
      browser_snapshot: {
        description: "Capture accessibility tree, interactive refs, visible text, and JPEG screenshot of the managed Web browser.",
        inputSchema: {
          type: "object",
          properties: {
            maxTextChars: { type: "number" },
            maxRefs: { type: "number" },
            includeScreenshot: { type: "boolean" },
            includeScreenshotBase64: { type: "boolean" },
          },
        },
      },
      browser_navigate: {
        description: "Navigate the managed browser to a URL (http/https).",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
      },
      browser_click: {
        description: "Click by ref from browser_snapshot (preferred), button/link text, CSS selector, or x/y coordinates.",
        inputSchema: {
          type: "object",
          properties: {
            ref: { type: "string" },
            text: { type: "string" },
            selector: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
          },
        },
      },
      browser_type: {
        description: "Type text into the focused element or a ref textbox/input.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
            ref: { type: "string" },
            clear: { type: "boolean" },
          },
          required: ["text"],
        },
      },
      browser_key: {
        description: "Press a keyboard key (Enter, Tab, Backspace, etc.).",
        inputSchema: {
          type: "object",
          properties: { key: { type: "string" } },
          required: ["key"],
        },
      },
      browser_scroll: {
        description: "Scroll the page by deltaY pixels; optional ref scrolls element into view first.",
        inputSchema: {
          type: "object",
          properties: {
            deltaY: { type: "number" },
            ref: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
          },
        },
      },
      browser_wait: {
        description: "Wait for timeout (ms) or load state.",
        inputSchema: {
          type: "object",
          properties: {
            ms: { type: "number" },
            until: { type: "string", enum: ["load", "networkidle"] },
          },
        },
      },
      browser_go_back: {
        description: "Browser back navigation.",
        inputSchema: { type: "object", properties: {} },
      },
      browser_list_tabs: {
        description: "List open tabs in the managed browser context.",
        inputSchema: { type: "object", properties: {} },
      },
      browser_switch_tab: {
        description: "Switch active tab by index from browser_list_tabs.",
        inputSchema: {
          type: "object",
          properties: { index: { type: "number" } },
          required: ["index"],
        },
      },
      browser_reset: {
        description: "Restart the managed Web browser (clears stale locks, keeps profile).",
        inputSchema: { type: "object", properties: {} },
      },
    };
    return {
      name,
      description: schemas[name].description,
      inputSchema: schemas[name].inputSchema,
    };
  });
}
