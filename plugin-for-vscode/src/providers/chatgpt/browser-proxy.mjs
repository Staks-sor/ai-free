// Веб-сессия ChatGPT через фоновый браузер (как Qwen).
//
// ЗАЧЕМ ИМЕННО UI, А НЕ ПРЯМОЙ API:
// ChatGPT защищает /backend-api/conversation токенами sentinel (proof-of-work) и
// Turnstile (Cloudflare). Эти токены генерирует САМ React-фронтенд внутри своего
// кода запроса — глобального перехватчика fetch (как у Qwen с bx-ua) здесь нет.
// Поэтому ручной fetch из page.evaluate их не получает и упирается в 403
// "Unusual activity" / Turnstile.
//
// РЕШЕНИЕ: держим фоновую сессию chatgpt.com и отправляем сообщение через настоящий
// интерфейс (ввод в поле + отправка). React сам подписывает запрос правильными
// токенами. Ответ забираем из сохранённого диалога (clean markdown) либо из DOM.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CHATGPT_AUTH_FILE, CHATGPT_BASE_URL, CHATGPT_BROWSER_PROFILE } from "./config.mjs";
import {
  applyCookiesToContext,
  clearBrowserCookiesViaCdp,
  estimateCookieHeaderBytes,
  isChatGPTAuthUsable,
  pickEssentialChatGPTCookies,
  readChatGPTAuth,
  replaceCookiesInContext,
  writeChatGPTAuth,
} from "./auth-files.mjs";
import {
  detectCloudflareChallenge,
  trySolveTurnstileCheckbox,
  waitForCloudflareClearance,
} from "./cloudflare-challenge.mjs";
import { killStaleChromeForProfile, launchNormalChromeForChatGPT, getChatGPTBrowserLaunchOptions } from "./browser-login.mjs";
import { getChatGPTChromium, getChatGPTEngineName } from "./engine.mjs";

const EMBED_PANEL_VIEWPORT = { width: 580, height: 900 };

let proxyPromise = null;
let proxyStatus = { state: "idle", error: "" };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const NAV_TIMEOUT_MS = Number(process.env.CHATGPT_NAV_TIMEOUT_MS || 35_000);
const READY_DELAY_MS = Number(process.env.CHATGPT_READY_DELAY_MS || 1500);
const COMPOSER_TIMEOUT_MS = Number(process.env.CHATGPT_COMPOSER_TIMEOUT_MS || 25_000);
const GENERATION_TIMEOUT_MS = Number(process.env.CHATGPT_GENERATION_TIMEOUT_MS || 300_000);
const CLOUDFLARE_WAIT_MS = Number(process.env.CHATGPT_CLOUDFLARE_WAIT_MS || 30_000);

function getChatGPTLaunchProfile() {
  return getChatGPTBrowserLaunchOptions();
}

function isTransientBrowserError(error) {
  if (isOversizedHeaderError(error)) return false;
  const message = String(error?.message || error || "");
  return /Execution context was destroyed|most likely because of a navigation|Target closed|Page closed|Context closed|Browser has been closed|net::ERR_ABORTED|net::ERR_NETWORK_CHANGED|Failed to fetch/i.test(message);
}

// Cloudflare/анти-бот блокирует сам документ (>=400) — типично для headless.
function isCloudflareBlockError(error) {
  const message = String(error?.message || error || "");
  return /net::ERR_HTTP_RESPONSE_CODE_FAILURE|net::ERR_BLOCKED_BY|HTTP 403|403 Forbidden|ERR_TOO_MANY_REDIRECTS/i.test(message);
}

// HTTP 431 — слишком большой заголовок Cookie (дубли cookies после sync/add).
function isOversizedHeaderError(error) {
  const message = String(error?.message || error || "");
  return /HTTP ERROR 431|HTTP 431|431/i.test(message)
    || (/net::ERR_HTTP_RESPONSE_CODE_FAILURE/i.test(message) && /chatgpt\.com/i.test(message));
}


// Code-agent иногда получает от ChatGPT сырой JSON tool-call — вытаскиваем message для UI.
export function normalizeChatGPTAssistantText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";

  const tryParseJson = (raw) => {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
      return null;
    } catch {
      return null;
    }
  };

  if (trimmed.startsWith("{")) {
    const fromJson = tryParseJson(trimmed);
    if (fromJson) return fromJson;
  }

  const fenced = trimmed.match(/```(?:json|python)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fenced) {
    const fromFence = tryParseJson(fenced[1]);
    if (fromFence) return fromFence;
  }

  return trimmed;
}

export async function closeChatGPTBrowserProxy() {
  const current = proxyPromise;
  proxyPromise = null;
  proxyStatus = { state: "idle", error: "" };
  if (!current) return;
  try {
    const proxy = await current;
    await proxy.close?.();
  } catch {}
}

export function resetChatGPTBrowserProxy() {
  closeChatGPTBrowserProxy().catch(() => {});
}

export function getChatGPTBrowserProxy({ debug = false } = {}) {
  if (!proxyPromise) {
    proxyStatus = { state: "starting", error: "" };
    proxyPromise = createProxy({ debug })
      .then((proxy) => {
        proxyStatus = { state: "ready", error: "" };
        return proxy;
      })
      .catch((err) => {
        proxyPromise = null;
        proxyStatus = { state: "error", error: String(err?.message || err) };
        throw err;
      });
  }
  return proxyPromise;
}

export function getChatGPTBrowserProxyStatus() {
  return { ...proxyStatus };
}

export function startChatGPTBrowserProxy(options = {}) {
  getChatGPTBrowserProxy(options).catch(() => {});
  return getChatGPTBrowserProxyStatus();
}

// После логина не закрываем Chrome — передаём живое окно в прокси (сессия не слетает).
export function isChatGPTBrowserProxyActive() {
  return Boolean(proxyPromise);
}

export async function syncChatGPTAuthFromActiveProxy() {
  if (!proxyPromise) return null;
  const proxy = await proxyPromise;
  if (typeof proxy.syncAuth !== "function") return null;
  return proxy.syncAuth();
}

export function adoptChatGPTBrowserSession(session, { debug = false } = {}) {
  if (proxyPromise) {
    proxyPromise
      .then((proxy) => proxy.close?.())
      .catch(() => {});
  }
  proxyStatus = { state: "starting", error: "" };
  proxyPromise = createProxy({ debug, adoptedSession: session })
    .then((proxy) => {
      proxyStatus = { state: "ready", error: "" };
      return proxy;
    })
    .catch((err) => {
      proxyPromise = null;
      proxyStatus = { state: "error", error: String(err?.message || err) };
      throw err;
    });
}

function cleanupProfileLocks(profileDir) {
  for (const file of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try { fs.unlinkSync(path.join(profileDir, file)); } catch {}
  }
}

async function createProxy({ debug, adoptedSession = null }) {
  const chromium = await getChatGPTChromium();
  const embedUi = process.env.CHATGPT_EMBED_IN_UI === "1";
  if (debug) console.log(`[chatgpt-proxy] using browser engine: ${getChatGPTEngineName()}`);

  const authState = { data: readChatGPTAuth(CHATGPT_AUTH_FILE) };
  const userAgent = authState.data?.userAgent || DEFAULT_UA;

  let context = null;
  let page = null;
  let browserSession = null;
  let sendCount = 0;
  let authPollTimer = null;
  let authWatchersAttached = false;

  async function syncAuthFromBrowser() {
    try {
      const cookies = pickEssentialChatGPTCookies(await context.cookies());
      const sessionTokenFromCookie = cookies.find((c) => c.name === "__Secure-next-auth.session-token")?.value || "";

      let session = null;
      try {
        session = await page.evaluate(async () => {
          const r = await fetch("/api/auth/session", {
            credentials: "include",
            headers: { Accept: "application/json" },
          });
          if (!r.ok) return null;
          return r.json();
        });
      } catch {}

      const accessToken = session?.accessToken || authState.data?.accessToken || "";
      const sessionToken = session?.sessionToken || sessionTokenFromCookie || authState.data?.sessionToken || "";

      if (!accessToken && !sessionToken) return null;

      const ua = await page.evaluate(() => navigator.userAgent).catch(() => userAgent);
      writeChatGPTAuth(CHATGPT_AUTH_FILE, {
        cookies,
        accessToken,
        sessionToken,
        profileDir: CHATGPT_BROWSER_PROFILE,
        userAgent: ua,
      });
      authState.data = readChatGPTAuth(CHATGPT_AUTH_FILE);
      if (debug) {
        console.log(
          `[chatgpt-proxy] synced auth (${cookies.length} cookies, token: ${Boolean(accessToken)}, session: ${Boolean(sessionToken)})`,
        );
      }
      return authState.data;
    } catch (error) {
      if (debug) console.log(`[chatgpt-proxy] syncAuth failed: ${error.message}`);
      return null;
    }
  }

  async function pruneBrowserCookiesIfNeeded({ force = false } = {}) {
    const raw = await context.cookies().catch(() => []);
    const essential = pickEssentialChatGPTCookies(raw);
    const rawBytes = estimateCookieHeaderBytes(raw);
    const shouldPrune = force || raw.length > 28 || rawBytes > 7000 || essential.length < raw.length;
    if (!shouldPrune) return false;

    await clearBrowserCookiesViaCdp(page, context);
    if (essential.length) {
      await applyCookiesToContext(context, essential);
    }
    writeChatGPTAuth(CHATGPT_AUTH_FILE, {
      cookies: essential,
      accessToken: authState.data?.accessToken || "",
      sessionToken: authState.data?.sessionToken || "",
      profileDir: CHATGPT_BROWSER_PROFILE,
      userAgent: authState.data?.userAgent || userAgent,
    });
    authState.data = readChatGPTAuth(CHATGPT_AUTH_FILE);
    if (debug) {
      console.log(`[chatgpt-proxy] pruned cookies ${raw.length} → ${essential.length} (${rawBytes}B → ${estimateCookieHeaderBytes(essential)}B)`);
    }
    return true;
  }

  async function launchBrowser() {
    const launch = getChatGPTLaunchProfile();
    const embedUi = process.env.CHATGPT_EMBED_IN_UI === "1";

    if (launch.useExternalChrome && !embedUi) {
      if (!browserSession && killStaleChromeForProfile(CHATGPT_BROWSER_PROFILE)) {
        await sleep(1200);
      }
      fs.mkdirSync(CHATGPT_BROWSER_PROFILE, { recursive: true });
      cleanupProfileLocks(CHATGPT_BROWSER_PROFILE);

      browserSession = await launchNormalChromeForChatGPT(chromium, CHATGPT_BROWSER_PROFILE, {
        initialUrl: "about:blank",
        clearCookies: false,
        headless: launch.headless,
        offscreen: launch.offscreen,
      });

      if (browserSession) {
        const ctx = browserSession.context;
        const pg = browserSession.page;
        const modeLabel = launch.offscreen ? "offscreen" : (launch.headless ? "headless" : "visible");
        if (debug) console.log(`[chatgpt-proxy] using real Chrome (cdp) ${modeLabel}`);
        return { ctx, pg };
      }
    }

    const { attachInAppBrowserSession, getInAppBrowserLaunchLabel } = await import("../../window-app/in-app-browser.mjs");
    browserSession = await attachInAppBrowserSession("chatgpt");
    if (debug) {
      console.log(`[chatgpt-proxy] in-app browser (${getInAppBrowserLaunchLabel()})`);
    }

    const ctx = browserSession.context;
    const pg = browserSession.page;

    if (authState.data?.cookies?.length) {
      try {
        await replaceCookiesInContext(ctx, authState.data.cookies, pg);
        if (debug) console.log(`[chatgpt-proxy] applied ${authState.data.cookies.length} cookies from auth.json (internal)`);
      } catch (e) {
        if (debug) console.error(`[chatgpt-proxy] failed to apply cookies (continuing): ${e.message}`);
      }
    }

    return { ctx, pg };
  }

  async function recoverFromOversizedCookies() {
    await pruneBrowserCookiesIfNeeded({ force: true });
  }

  async function navigateHome(pg, { recovered = false, waitForChallenge = true } = {}) {
    await pruneBrowserCookiesIfNeeded();
    try {
      await pg.goto(`${CHATGPT_BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      await pg.waitForTimeout(READY_DELAY_MS);
      const state = await detectPageState();
      if (state.challenge && waitForChallenge) {
        await waitThroughCloudflareChallenge();
      }
    } catch (error) {
      if (!recovered && isOversizedHeaderError(error)) {
        if (debug) console.log("[chatgpt-proxy] HTTP 431 on navigate — pruning cookies via CDP");
        await recoverFromOversizedCookies();
        return navigateHome(pg, { recovered: true, waitForChallenge });
      }
      throw error;
    }
  }

  if (adoptedSession) {
    context = adoptedSession.context;
    page = adoptedSession.page;
    browserSession = adoptedSession;
    if (debug) console.log("[chatgpt-proxy] adopted login browser — окно остаётся открытым");
    await syncAuthFromBrowser();
  } else {
    const r = await launchBrowser();
    context = r.ctx;
    page = r.pg;
    try {
      await pruneBrowserCookiesIfNeeded();
      if (!/chatgpt\.com/.test(page.url())) {
        // На первом открытии не ждём Cloudflare: страницу с checkbox нужно сразу
        // показать пользователю во внутренней панели.
        await navigateHome(page, { waitForChallenge: false });
      } else {
        await page.waitForTimeout(READY_DELAY_MS);
      }
    } catch (error) {
      if (embedUi) {
        const { closeInAppBrowser } = await import("../../window-app/in-app-browser.mjs");
        await closeInAppBrowser().catch(() => {});
      } else if (browserSession?.close) {
        try { await browserSession.close(); } catch {}
        browserSession = null;
      } else {
        try { await context?.close(); } catch {}
      }
      if (isCloudflareBlockError(error)) {
        throw new Error("ChatGPT: доступ к chatgpt.com заблокирован (Cloudflare). Обнови вход. authentication");
      }
      throw error;
    }
  }

  if (debug) console.log("[chatgpt-proxy] page loaded and ready");

  const close = async () => {
    if (authPollTimer) {
      clearTimeout(authPollTimer);
      authPollTimer = null;
    }
    if (browserSession?.close) {
      try { await browserSession.close(); } catch {}
      browserSession = null;
    } else {
      try { await context?.close(); } catch {}
    }
  };
  process.once("exit", () => { close(); });

  async function detectPageState() {
    return detectCloudflareChallenge(page);
  }

  async function waitThroughCloudflareChallenge({ maxMs = CLOUDFLARE_WAIT_MS } = {}) {
    return waitForCloudflareClearance(page, { maxMs, debug });
  }

  // Проверяет залогиненность через /api/auth/session (наличие accessToken).
  // Возвращает true/false/null (null — не удалось определить).
  async function checkLoggedIn() {
    try {
      return await page.evaluate(async () => {
        try {
          const r = await fetch("/api/auth/session", {
            credentials: "include",
            headers: { Accept: "application/json" },
          });
          if (!r.ok) return false;
          const j = await r.json();
          return Boolean(j && j.accessToken);
        } catch {
          return null;
        }
      });
    } catch {
      return null;
    }
  }

  async function findComposerLocator() {
    const selectors = ["#prompt-textarea", 'div[contenteditable="true"]', "textarea#prompt-textarea", "textarea"];
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.count().catch(() => 0)) {
        if (await locator.isVisible().catch(() => false)) return locator;
      }
    }
    return null;
  }

  async function getComposer() {
    const deadline = Date.now() + COMPOSER_TIMEOUT_MS;
    let reloaded = false;
    const startedAt = Date.now();
    while (Date.now() < deadline) {
      const found = await findComposerLocator();
      if (found) return found;

      const state = await detectPageState();
      if (state.challenge) {
        if (!(await waitThroughCloudflareChallenge())) {
          throw new Error(
            "ChatGPT: Cloudflare не пройден. Откройте 🧠 → Браузер → ChatGPT, пройдите проверку и нажмите «Синхронизировать». authentication",
          );
        }
        const afterChallenge = await findComposerLocator();
        if (afterChallenge) return afterChallenge;
      }

      // Не залогинены — даём SPA несколько секунд поднять сессию после навигации.
      const loggedIn = await checkLoggedIn();
      if (loggedIn === false && Date.now() - startedAt > 6000) {
        throw new Error(
          "ChatGPT: сессия не активна (нет входа). Войди через кнопку авторизации. not logged in",
        );
      }

      // Одна перезагрузка через ~12с — лечит подвисший SPA / частичную загрузку.
      if (!reloaded && Date.now() - startedAt > 12_000) {
        reloaded = true;
        try { await navigateHome(page); } catch {}
      }
      await page.waitForTimeout(800);
    }
    // Финальное решение по статусу входа.
    const loggedIn = await checkLoggedIn();
    if (loggedIn) {
      throw new Error("ChatGPT: вход есть, но поле ввода не отрисовалось. Повтори запрос.");
    }
    throw new Error(
      "ChatGPT: не вижу поле ввода — похоже, не выполнен вход. Войди через кнопку авторизации. not logged in",
    );
  }

  async function readStreamingAssistantText() {
    const dom = await page
      .evaluate(() => {
        const nodes = document.querySelectorAll('[data-message-author-role="assistant"]');
        const last = nodes[nodes.length - 1];
        if (!last) return "";
        const md = last.querySelector(".markdown") || last;
        return (md.innerText || "").trim();
      })
      .catch(() => "");
    return normalizeChatGPTAssistantText(dom);
  }

  async function waitForGenerationToFinish(beforeAssistantCount, onText = null) {
    // Ждём появления нового ответа ассистента или кнопки "стоп".
    await Promise.race([
      page
        .waitForSelector('[data-testid="stop-button"]', { timeout: 25_000 })
        .catch(() => {}),
      page
        .waitForFunction(
          (n) => document.querySelectorAll('[data-message-author-role="assistant"]').length > n,
          beforeAssistantCount,
          { timeout: 25_000 },
        )
        .catch(() => {}),
    ]);

    if (!onText) {
      await page
        .waitForSelector('[data-testid="stop-button"]', { state: "detached", timeout: GENERATION_TIMEOUT_MS })
        .catch(() => {});
      await page.waitForTimeout(900);
      return;
    }

    let lastText = "";
    let sawGeneration = false;
    const deadline = Date.now() + GENERATION_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const stopCount = await page.locator('[data-testid="stop-button"]').count().catch(() => 0);
      const assistantCount = await page
        .locator('[data-message-author-role="assistant"]')
        .count()
        .catch(() => 0);

      if (stopCount > 0 || assistantCount > beforeAssistantCount) {
        sawGeneration = true;
        const text = await readStreamingAssistantText();
        if (text && text !== lastText) {
          onText(text);
          lastText = text;
        }
      }

      if (sawGeneration && stopCount === 0) {
        await page.waitForTimeout(350);
        const text = await readStreamingAssistantText();
        if (text && text !== lastText) {
          onText(text);
          lastText = text;
        }
        const stopAgain = await page.locator('[data-testid="stop-button"]').count().catch(() => 0);
        if (stopAgain === 0) break;
      }

      await page.waitForTimeout(280);
    }
    await page.waitForTimeout(400);
  }

  async function extractAssistantAnswer(conversationId) {
    const accessToken = authState.data?.accessToken || "";
    // 1) Чистый markdown из сохранённого диалога (GET не требует sentinel).
    if (conversationId && accessToken) {
      const clean = await page
        .evaluate(
          async ({ convId, token }) => {
            try {
              const r = await fetch(`/backend-api/conversation/${convId}`, {
                headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
                credentials: "include",
              });
              if (!r.ok) return null;
              const j = await r.json();
              const pickText = (m) =>
                (m?.content?.parts || []).filter((p) => typeof p === "string").join("\n");
              const node = j.mapping?.[j.current_node]?.message;
              if (node && node.author?.role === "assistant") {
                const t = pickText(node);
                if (t) return { text: t, id: node.id };
              }
              let best = null;
              for (const key of Object.keys(j.mapping || {})) {
                const m = j.mapping[key]?.message;
                if (m?.author?.role === "assistant" && (m.content?.parts || []).length) {
                  if (!best || (m.create_time || 0) > (best.create_time || 0)) best = m;
                }
              }
              if (best) {
                const t = pickText(best);
                if (t) return { text: t, id: best.id };
              }
              return null;
            } catch {
              return null;
            }
          },
          { convId: conversationId, token: accessToken },
        )
        .catch(() => null);
      if (clean?.text) {
        return { text: normalizeChatGPTAssistantText(clean.text), id: clean.id };
      }
    }

    // 2) Фолбэк: текст из DOM (innerText последнего ответа ассистента).
    const dom = await page
      .evaluate(() => {
        const nodes = document.querySelectorAll('[data-message-author-role="assistant"]');
        const last = nodes[nodes.length - 1];
        if (!last) return { text: "", id: null };
        const md = last.querySelector(".markdown") || last;
        return { text: (md.innerText || "").trim(), id: last.getAttribute("data-message-id") || null };
      })
      .catch(() => ({ text: "", id: null }));
    return { text: normalizeChatGPTAssistantText(dom.text), id: dom.id };
  }

  // Вытаскивает сгенерированные ChatGPT картинки из последнего ответа и отдаёт
  // их как data-URL. Байты качаем через Node (context.request) — без CORS-проблем.
  async function extractAssistantImages() {
    const items = await page
      .evaluate(() => {
        const nodes = document.querySelectorAll('[data-message-author-role="assistant"]');
        const last = nodes[nodes.length - 1];
        if (!last) return [];
        const out = [];
        for (const im of last.querySelectorAll("img")) {
          const src = im.currentSrc || im.src || "";
          if (!src) continue;
          const w = im.naturalWidth || im.width || 0;
          const h = im.naturalHeight || im.height || 0;
          const looksGenerated =
            (w >= 200 && h >= 200) ||
            /oaiusercontent|\/backend-api\/files|dalle|sdmnt|file-/i.test(src);
          if (looksGenerated) out.push({ src, isBlob: src.startsWith("blob:") });
        }
        return out;
      })
      .catch(() => []);

    const results = [];
    for (const it of items) {
      if (it.src.startsWith("data:")) {
        results.push(it.src);
        continue;
      }
      if (it.isBlob) {
        const dataUrl = await page
          .evaluate(async (u) => {
            try {
              const r = await fetch(u);
              const b = await r.blob();
              return await new Promise((res) => {
                const fr = new FileReader();
                fr.onloadend = () => res(fr.result);
                fr.readAsDataURL(b);
              });
            } catch {
              return null;
            }
          }, it.src)
          .catch(() => null);
        if (dataUrl) results.push(dataUrl);
        continue;
      }
      try {
        const resp = await context.request.get(it.src, { timeout: 60_000 });
        if (!resp.ok()) continue;
        const ct = String(resp.headers()["content-type"] || "image/png").split(";")[0];
        if (!/^image\//.test(ct)) continue;
        const buf = await resp.body();
        results.push(`data:${ct};base64,${buf.toString("base64")}`);
      } catch {}
    }
    return results;
  }

  async function gotoHome({ waitForChallenge } = {}) {
    const wait = waitForChallenge ?? !embedUi;
    try {
      await navigateHome(page, { waitForChallenge: wait });
    } catch (error) {
      if (isOversizedHeaderError(error)) {
        throw new Error("ChatGPT: слишком много cookies в браузере (HTTP 431). Нажми «Войти» заново. authentication");
      }
      if (isCloudflareBlockError(error)) {
        throw new Error("ChatGPT: доступ к chatgpt.com заблокирован (Cloudflare). Обнови вход. authentication");
      }
      throw error;
    }
  }

  // Новый чат без полной перезагрузки — меньше шансов словить 431 на раздутом Cookie.
  async function openFreshChat() {
    const url = page.url();
    if (/chatgpt\.com\/?([?#]|$)/.test(url)) return;

    if (/chatgpt\.com\/c\//.test(url)) {
      const selectors = [
        '[data-testid="create-new-chat-button"]',
        'a[href="/"]',
        'nav a[href="/"]',
      ];
      for (const selector of selectors) {
        const locator = page.locator(selector).first();
        if (await locator.count().catch(() => 0)) {
          if (await locator.isVisible().catch(() => false)) {
            await locator.click();
            await page.waitForTimeout(READY_DELAY_MS);
            return;
          }
        }
      }
      // SPA-переход без полной перезагрузки — меньше шансов на 431.
      try {
        await page.evaluate(() => {
          window.history.pushState({}, "", "/");
          window.dispatchEvent(new PopStateEvent("popstate"));
        });
        await page.waitForTimeout(READY_DELAY_MS);
        if (await findComposerLocator()) return;
      } catch {}
    }

    await gotoHome();
  }

  // Открыть существующий диалог по прямой ссылке. ChatGPT иногда отдаёт документ
  // с кодом >=400 на deep-link (ERR_HTTP_RESPONSE_CODE_FAILURE) — тогда откатываемся
  // на главную и продолжаем в свежем диалоге (для агента это безопасно).
  async function gotoConversation(conversationId) {
    try {
      await page.goto(`${CHATGPT_BASE_URL}/c/${conversationId}`, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      await page.waitForTimeout(READY_DELAY_MS);
      // Если редиректнуло не на этот диалог (404 → на главную) — считаем диалог недоступным.
      if (!page.url().includes(`/c/${conversationId}`)) return null;
      return conversationId;
    } catch (error) {
      if (isOversizedHeaderError(error)) {
        try {
          await recoverFromOversizedCookies();
          await page.goto(`${CHATGPT_BASE_URL}/c/${conversationId}`, {
            waitUntil: "domcontentloaded",
            timeout: NAV_TIMEOUT_MS,
          });
          await page.waitForTimeout(READY_DELAY_MS);
          if (!page.url().includes(`/c/${conversationId}`)) return null;
          return conversationId;
        } catch {}
      }
      if (debug) console.log(`[chatgpt-proxy] deep-link nav failed (${error.message}); starting fresh chat`);
      try { await gotoHome(); } catch {}
      return null;
    }
  }

  // Записывает inline-картинки во временные файлы для setInputFiles.
  function writeTempImages(images) {
    const written = [];
    const safeExt = (mime, name) => {
      const fromName = (String(name || "").split(".").pop() || "").toLowerCase();
      if (/^(png|jpg|jpeg|gif|webp|bmp)$/.test(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
      const m = String(mime || "").toLowerCase();
      if (m.includes("png")) return "png";
      if (m.includes("webp")) return "webp";
      if (m.includes("gif")) return "gif";
      return "jpg";
    };
    for (const img of images) {
      if (!img?.dataBase64) continue;
      const ext = safeExt(img.mimeType, img.name);
      const filePath = path.join(os.tmpdir(), `chatgpt-img-${randomUUID()}.${ext}`);
      fs.writeFileSync(filePath, Buffer.from(img.dataBase64, "base64"));
      written.push(filePath);
    }
    return written;
  }

  // Прикрепляет картинки в веб-композер ChatGPT и ждёт окончания загрузки.
  async function attachImages(imagePaths) {
    if (!imagePaths.length) return;
    const fileInput = page.locator('input[type="file"]').first();
    try {
      await fileInput.waitFor({ state: "attached", timeout: 15_000 });
    } catch {
      throw new Error("ChatGPT: не найден input для загрузки изображения в композере.");
    }
    await fileInput.setInputFiles(imagePaths);
    // Ждём, пока превью появятся и загрузка завершится. Признак готовности —
    // в композере отрисованы img-превью и нет индикаторов прогресса.
    const deadline = Date.now() + 120_000;
    await page.waitForTimeout(1500);
    while (Date.now() < deadline) {
      const status = await page
        .evaluate(() => {
          const form = document.querySelector("form") || document.body;
          const imgs = form.querySelectorAll('img[src^="blob:"], img[src^="data:"]');
          const uploading = form.querySelectorAll('[role="progressbar"], svg[class*="spin"], [class*="uploading"]');
          return { previews: imgs.length, uploading: uploading.length };
        })
        .catch(() => ({ previews: 0, uploading: 0 }));
      if (status.previews >= imagePaths.length && status.uploading === 0) break;
      await page.waitForTimeout(800);
    }
    // Финальная пауза для стабилизации.
    await page.waitForTimeout(800);
  }

  async function sendChatOnce({ prompt, conversationId, onText, images = [] }) {
    sendCount += 1;
    if (sendCount % 4 === 0) {
      await pruneBrowserCookiesIfNeeded();
    }

    const currentUrl = page.url();
    const alreadyThere = conversationId
      ? currentUrl.includes(`/c/${conversationId}`)
      : /chatgpt\.com\/?([?#]|$)/.test(currentUrl);
    if (!alreadyThere) {
      if (conversationId) {
        // На успехе остаёмся в нужном диалоге; на провале gotoConversation уже на главной.
        await gotoConversation(conversationId);
      } else {
        await openFreshChat();
      }
    }

    const composer = await getComposer();
    const beforeAssistantCount = await page
      .locator('[data-message-author-role="assistant"]')
      .count()
      .catch(() => 0);

    const tempImagePaths = images?.length ? writeTempImages(images) : [];
    try {
      if (tempImagePaths.length) {
        await attachImages(tempImagePaths);
      }

      await composer.click();
      try {
        await composer.fill(prompt);
      } catch {
        // contenteditable иногда не принимает fill — печатаем напрямую.
        await composer.click();
        await page.keyboard.insertText(prompt);
      }

      const sendButton = page.locator('[data-testid="send-button"]').first();
      try {
        // С картинками ждём дольше: кнопка отправки активна только после загрузки.
        await sendButton.waitFor({ state: "visible", timeout: tempImagePaths.length ? 60_000 : 5000 });
        await sendButton.click();
      } catch {
        await page.keyboard.press("Enter");
      }
    } finally {
      for (const filePath of tempImagePaths) {
        try { fs.unlinkSync(filePath); } catch {}
      }
    }

    await waitForGenerationToFinish(beforeAssistantCount, onText);

    const resolvedConversationId =
      /\/c\/([0-9a-fA-F-]+)/.exec(page.url())?.[1] || conversationId || null;
    const answer = await extractAssistantAnswer(resolvedConversationId);
    const domText = await readStreamingAssistantText();
    if (domText.length > (answer.text || "").length) {
      answer.text = domText;
    }
    // ChatGPT мог сгенерировать картинку (DALL·E) — переносим её к нам.
    const generatedImages = await extractAssistantImages();

    if (!answer.text && !generatedImages.length) {
      const state = await detectPageState();
      if (state.challenge) {
        throw new Error(
          "ChatGPT: Cloudflare помешал получить ответ. 🧠 → Браузер → пройдите проверку → «Синхронизировать». authentication",
        );
      }
      throw new Error("ChatGPT: ответ получить не удалось (пустой текст). Повтори запрос.");
    }

    // Только обновляем accessToken — не тащим весь cookie-jar после каждого сообщения.
    try {
      const session = await page.evaluate(async () => {
        const r = await fetch("/api/auth/session", { credentials: "include", headers: { Accept: "application/json" } });
        if (!r.ok) return null;
        return r.json();
      });
      if (session?.accessToken && authState.data) {
        authState.data.accessToken = session.accessToken;
        writeChatGPTAuth(CHATGPT_AUTH_FILE, {
          cookies: authState.data.cookies,
          accessToken: session.accessToken,
          sessionToken: authState.data.sessionToken,
          profileDir: CHATGPT_BROWSER_PROFILE,
          userAgent: authState.data.userAgent || userAgent,
        });
      }
    } catch {}

    return {
      text: answer.text,
      conversationId: resolvedConversationId,
      lastMessageId: answer.id || null,
      images: generatedImages,
    };
  }

  async function sendChat({ prompt, conversationId = null, onText = null, images = [] }) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await sendChatOnce({ prompt, conversationId, onText, images });
      } catch (error) {
        lastError = error;
        if (!isTransientBrowserError(error) || attempt === 1) throw error;
        if (debug) console.log(`[chatgpt-proxy] transient error, reloading and retrying: ${error.message}`);
        try { await gotoHome(); } catch {}
      }
    }
    throw lastError;
  }

  // Проверка, что веб-сессия жива и доступно поле ввода. Если нет — бросает
  // auth-ошибку ("not logged in"/challenge), чтобы внешний слой переоткрыл вход.
  // Делает одну перезагрузку-ретрай: лечит частые headless/Cloudflare затыки.
  async function ensureReady() {
    if (!/chatgpt\.com/.test(page.url())) {
      await gotoHome();
    }
    try {
      await getComposer();
      await syncAuthFromBrowser();
      return true;
    } catch (firstError) {
      if (debug) console.log(`[chatgpt-proxy] ensureReady: composer missing (${firstError.message}); reloading once`);
      try { await gotoHome(); } catch {}
      await getComposer();
      await syncAuthFromBrowser();
      return true;
    }
  }

  function startAuthAutoSave() {
    if (authWatchersAttached) return;
    authWatchersAttached = true;

    const tryPersist = async () => {
      const beforeUsable = isChatGPTAuthUsable(authState.data);
      const saved = await syncAuthFromBrowser();
      if (saved && isChatGPTAuthUsable(saved) && !beforeUsable && debug) {
        console.log("[chatgpt-proxy] session auto-saved after login");
      }
      return saved;
    };

    context.on("response", async (response) => {
      try {
        if (!response.url().includes("/api/auth/session") || response.status() !== 200) return;
        await tryPersist();
      } catch {}
    });

    page.on("load", () => {
      setTimeout(() => { tryPersist().catch(() => {}); }, 1500);
    });

    const poll = async () => {
      if (!context || page.isClosed()) return;
      if (!isChatGPTAuthUsable(authState.data)) {
        await tryPersist().catch(() => {});
      }

      let isChallenged = false;
      try {
        const state = await detectPageState();
        if (state.challenge) {
          isChallenged = true;
          // В embed-режиме Cloudflare проходит пользователь кликом в панели — не автокликаем.
          if (!embedUi) {
            await trySolveTurnstileCheckbox(page, { debug });
          }
        }
      } catch (err) {
        if (debug) console.log("[chatgpt-proxy] Turnstile background poll check failed:", err.message);
      }

      const nextDelay = isChallenged ? 2000 : (isChatGPTAuthUsable(authState.data) ? 30_000 : 2500);
      authPollTimer = setTimeout(poll, nextDelay);
    };
    poll();
  }

  startAuthAutoSave();

  return {
    sendChat,
    ensureReady,
    syncAuth: syncAuthFromBrowser,
    getPageState: detectPageState,
    close,
    getPage: () => page,
    getContext: () => context,
    navigateHome: gotoHome,
  };
}
