import { backgroundBrowserPool } from "../../browser/session-pool.mjs";
import { browserRequestPolicies } from "../browser-request-policy.mjs";
import { withAccountActivitySession, profileActivityId } from "../activity-session.mjs";
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
  getChatGPTSessionToken,
  isChatGPTAuthUsable,
  pickEssentialChatGPTCookies,
  readChatGPTAuth,
  restoreSavedChatGPTCookiesIfMissing,
  writeChatGPTAuth,
} from "./auth-files.mjs";
import {
  detectCloudflareChallenge,
  trySolveTurnstileCheckbox,
  waitForCloudflareClearance,
} from "./cloudflare-challenge.mjs";
import { killStaleChromeForProfile, launchNormalChromeForChatGPT, getChatGPTBrowserLaunchOptions, isSuccessfulChatGPTSession, launchInternalBrowserContext } from "./browser-login.mjs";
import { getChatGPTChromium, getChatGPTEngineName } from "./engine.mjs";
import { createChatGPTModelUnavailableError, resolveChatGPTModelSelection, resolveChatGPTRequestedModel } from "./model-selection.mjs";

const EMBED_PANEL_VIEWPORT = { width: 580, height: 900 };

let proxyPromise = null;
const accountProxies = new Map();
let proxyStatus = { state: "idle", error: "" };
let idleCloseTimer = null;
export function getChatGPTBrowserIdleCloseDelay(env = process.env) {
  const configured = String(env.CHATGPT_BROWSER_IDLE_MS || "").trim();
  if (!configured) return null;
  const delayMs = Number(configured);
  return Number.isFinite(delayMs) && delayMs > 0 ? Math.max(5_000, delayMs) : null;
}

const BROWSER_IDLE_CLOSE_MS = getChatGPTBrowserIdleCloseDelay();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const NAV_TIMEOUT_MS = Number(process.env.CHATGPT_NAV_TIMEOUT_MS || 35_000);
const READY_DELAY_MS = Number(process.env.CHATGPT_READY_DELAY_MS || 1500);
const COMPOSER_TIMEOUT_MS = Number(process.env.CHATGPT_COMPOSER_TIMEOUT_MS || 25_000);
const GENERATION_TIMEOUT_MS = Number(process.env.CHATGPT_GENERATION_TIMEOUT_MS || 30 * 60_000);
const GENERATION_START_TIMEOUT_MS = Number(process.env.CHATGPT_GENERATION_START_TIMEOUT_MS || 45_000);
const GENERATION_INACTIVITY_TIMEOUT_MS = Number(process.env.CHATGPT_GENERATION_INACTIVITY_TIMEOUT_MS || 90_000);
const GENERATION_EVENT_WATCHDOG_MS = 1_000;
const GENERATION_STOP_QUIET_MS = 750;
const GENERATION_STABLE_QUIET_MS = 8_000;
const CLOUDFLARE_WAIT_MS = Number(process.env.CHATGPT_CLOUDFLARE_WAIT_MS || 30_000);

// Only this test id identifies active text generation. Broad aria-label matches also
// catch persistent response actions such as “Stop reading aloud”, which made a
// completed answer look active until every 300-second wait expired.
export const CHATGPT_GENERATION_STOP_SELECTOR = '[data-testid="stop-button"]';

export function hasChatGPTResponseChanged(before = {}, current = {}) {
  if (Number(current.count || 0) > Number(before.count || 0)) return true;
  if (Number(current.count || 0) < 1) return false;
  const beforeId = String(before.id || "");
  const currentId = String(current.id || "");
  if (currentId && currentId !== beforeId) return true;
  return String(current.text || "").trim() !== String(before.text || "").trim();
}

const CHATGPT_OBSERVATION_FIELDS = [
  "count",
  "id",
  "text",
  "generating",
  "readyForNextPrompt",
  "error",
];

export function advanceChatGPTFallbackObservation(previous, current = {}, now = Date.now()) {
  const state = Object.fromEntries(CHATGPT_OBSERVATION_FIELDS.map((key) => [key, current[key] ?? ""]));
  if (!previous) return { ...state, version: 1, changedAt: now };
  const changed = CHATGPT_OBSERVATION_FIELDS.some((key) => previous[key] !== state[key]);
  if (!changed) return previous;
  return {
    ...state,
    version: Number(previous.version || 0) + 1,
    changedAt: now,
  };
}

export function selectPreferredChatGPTAssistantText(savedText, domText) {
  const saved = normalizeChatGPTAssistantText(savedText);
  const dom = normalizeChatGPTAssistantText(domText);
  return dom.length > saved.length ? dom : saved;
}

export function getChatGPTObservationDecision({
  responseChanged,
  text,
  generating,
  sawGenerating,
  readyForNextPrompt,
  quietForMs,
  quietThresholdMs,
}) {
  if (generating) return { done: false, reason: "generating" };
  if (!sawGenerating && !readyForNextPrompt) return { done: false, reason: "waiting" };
  if (!responseChanged || !String(text || "").trim() || quietForMs < quietThresholdMs) {
    return { done: false, reason: "waiting" };
  }
  return { done: true, reason: sawGenerating ? "generation-stopped" : "answer-stable" };
}

// The observer lives inside ChatGPT's page. It reads the DOM only when the SPA
// changes it and emits a coalesced state event; Node no longer scans the entire
// conversation every 300 ms.
export async function installChatGPTDomObserver(page) {
  return page.evaluate(({ stopSelector }) => {
    const key = "__aiFreeChatGPTObserver";
    window[key]?.observer?.disconnect?.();
    const visible = (node) => Boolean(node && node.getClientRects().length);
    const read = () => {
      const nodes = document.querySelectorAll('[data-message-author-role="assistant"]');
      const last = nodes[nodes.length - 1];
      const markdown = last?.querySelector(".markdown") || last;
      const composer = document.querySelector('#prompt-textarea[contenteditable="true"]');
      let error = "";
      for (const selector of [
        '[data-testid="conversation-turn-error"]',
        '[data-testid="response-error"]',
        '[role="alert"]',
      ]) {
        const match = [...document.querySelectorAll(selector)].find(visible);
        const value = (match?.innerText || match?.textContent || "").trim();
        if (value) { error = value; break; }
      }
      return {
        count: nodes.length,
        id: last?.getAttribute("data-message-id") || "",
        text: (markdown?.innerText || "").trim(),
        generating: [...document.querySelectorAll(stopSelector)].some(visible)
          || Boolean(last?.matches?.('[aria-busy="true"], [data-is-streaming="true"]')),
        readyForNextPrompt: visible(composer) && composer?.getAttribute("aria-disabled") !== "true",
        error,
      };
    };
    const initial = read();
    const store = { observer: null, version: 1, changedAt: Date.now(), state: initial, scheduled: false };
    const publish = () => {
      store.scheduled = false;
      const next = read();
      const changed = JSON.stringify(next) !== JSON.stringify(store.state);
      if (!changed) return;
      store.state = next;
      store.version += 1;
      store.changedAt = Date.now();
      window.dispatchEvent(new CustomEvent("ai-free-chatgpt-state", { detail: store.version }));
    };
    store.observer = new MutationObserver(() => {
      if (store.scheduled) return;
      store.scheduled = true;
      queueMicrotask(publish);
    });
    store.observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-message-id", "data-testid", "aria-busy", "hidden", "style", "class"],
    });
    window[key] = store;
    return true;
  }, { stopSelector: CHATGPT_GENERATION_STOP_SELECTOR });
}

export async function countVisibleChatGPTControls(locator) {
  const count = await locator.count().catch(() => 0);
  let visibleCount = 0;
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) visibleCount += 1;
  }
  return visibleCount;
}

export function getChatGPTGenerationWaitFailure({ elapsedMs, sawGeneration, pageError, startTimeoutMs = GENERATION_START_TIMEOUT_MS }) {
  const errorText = String(pageError || "").trim();
  if (errorText) return `ChatGPT сообщил об ошибке: ${errorText}`;
  if (!sawGeneration && elapsedMs >= startTimeoutMs) {
    return `ChatGPT не начал формировать ответ за ${Math.round(startTimeoutMs / 1000)} секунд.`;
  }
  return "";
}

export function getChatGPTSubmittedTurn(request) {
  try {
    if (request.method() !== "POST"
      || !/^\/backend-api\/(?:f\/)?conversation$/.test(new URL(request.url()).pathname)) return null;
    const body = request.postDataJSON();
    const user = body?.messages?.findLast((message) => message.author?.role === "user");
    return user?.id ? { userMessageId: user.id, conversationId: body.conversation_id || null } : null;
  } catch {
    return null;
  }
}

// The editor can flatten newlines and escape Markdown in the submitted text.
// Prefer the native user message ID; exact text/time matching remains a fallback.
export async function findChatGPTSavedResponse({
  accessToken, cookies = [], userAgent = "", prompt, sentAtMs, conversationId = null, userMessageId = null, fetchImpl = fetch,
}) {
  if (!accessToken || !prompt || !sentAtMs) return null;
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  const cookieHeader = cookies
    .filter((cookie) => {
      const domain = String(cookie?.domain || "").toLowerCase();
      return domain === "chatgpt.com" || domain.endsWith(".chatgpt.com");
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  if (cookieHeader) headers.Cookie = cookieHeader;
  if (userAgent) headers["User-Agent"] = userAgent;
  const getJson = async (pathname) => {
    try {
      const response = await fetchImpl(`${CHATGPT_BASE_URL}${pathname}`, {
        headers,
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  };
  const asTimeMs = (value) => typeof value === "number" ? value * 1000 : Date.parse(value || "");
  let ids = conversationId ? [conversationId] : [];
  if (!ids.length) {
    const recent = await getJson("/backend-api/conversations?offset=0&limit=10");
    ids = (recent?.items || [])
      .filter((item) => asTimeMs(item.create_time) >= sentAtMs - 2_000)
      .map((item) => item.id)
      .filter(Boolean)
      .slice(0, 3);
  }

  for (const id of ids) {
    const conversation = await getJson(`/backend-api/conversation/${encodeURIComponent(id)}`);
    const mapping = conversation?.mapping || {};
    let nodeId = conversation?.current_node;
    let assistant = null;
    while (nodeId && mapping[nodeId]) {
      const node = mapping[nodeId];
      const message = node.message;
      if (!assistant && message?.author?.role === "assistant") assistant = message;
      if (message?.author?.role === "user") {
        const userText = (message.content?.parts || []).filter((part) => typeof part === "string").join("\n").trim();
        const answerText = (assistant?.content?.parts || []).filter((part) => typeof part === "string").join("\n").trim();
        const matchesSubmittedTurn = userMessageId
          ? message.id === userMessageId
          : userText === String(prompt).trim() && asTimeMs(message.create_time) >= sentAtMs - 2_000;
        if (matchesSubmittedTurn
          && assistant?.status === "finished_successfully"
          && asTimeMs(assistant.create_time) >= asTimeMs(message.create_time)
          && answerText) {
          return { conversationId: id, id: assistant.id, text: normalizeChatGPTAssistantText(answerText) };
        }
        break;
      }
      nodeId = node.parent;
    }
  }
  return null;
}

function getChatGPTLaunchProfile() {
  return getChatGPTBrowserLaunchOptions();
}

// A single browser attempt; only the client owns transport recovery.
export async function runChatGPTBrowserSend(sendOnce, options, stopGeneration) {
  const attemptState = { promptSubmitted: false };
  options.signal?.throwIfAborted();
  try {
    const result = await sendOnce({ ...options, attemptState });
    options.signal?.throwIfAborted();
    return result;
  } catch (error) {
    error.promptSubmitted = attemptState.promptSubmitted;
    error.delivery ||= attemptState.promptSubmitted ? "unknown" : "not_sent";
    if (options.signal?.aborted && attemptState.promptSubmitted) {
      try { await stopGeneration(); } catch {}
    }
    throw error;
  }
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

const CHATGPT_COMPOSER_SELECTORS = [
  "#prompt-textarea",
  'div[contenteditable="true"]',
  "textarea#prompt-textarea",
  "textarea",
];

export function createChatGPTComposerUnavailableError() {
  const error = new Error(
    "ChatGPT: вход сохранён, но поле ввода не отрисовалось. Откройте 🧠 → Браузер → ChatGPT и завершите вход.",
  );
  error.needsChatGPTLogin = true;
  return error;
}

function isStaleComposerError(error) {
  return /detached|not attached|not enabled|not visible|Timeout.*exceeded|Element is not/i.test(
    String(error?.message || error || ""),
  );
}

// ChatGPT replaces its fallback textarea while the SPA hydrates or changes model.
// Never keep that locator across UI transitions: acquire an enabled element for each attempt.
export async function fillChatGPTComposer(page, prompt, { timeoutMs = COMPOSER_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    for (const selector of CHATGPT_COMPOSER_SELECTORS) {
      const matches = page.locator(selector);
      const count = await matches.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const composer = matches.nth(index);
        const visible = await composer.isVisible().catch(() => false);
        const enabled = visible && await composer.isEnabled().catch(() => false);
        if (!enabled) continue;

        try {
          await composer.click({ timeout: 2_000 });
          try {
            await composer.fill(prompt, { timeout: 5_000 });
          } catch (error) {
            if (isStaleComposerError(error)) throw error;
            await page.keyboard.insertText(prompt);
          }
          return composer;
        } catch (error) {
          lastError = error;
          if (!isStaleComposerError(error)) throw error;
        }
      }
    }
    await page.waitForTimeout(100);
  }

  throw new Error(
    `ChatGPT: поле ввода не стало активным. Обновите окно ChatGPT и повторите запрос.${lastError ? ` ${lastError.message || lastError}` : ""}`,
  );
}

export async function closeChatGPTBrowserProxy(accountId = "default") {
  if (accountId !== "default") {
    const proxy = accountProxies.get(accountId); accountProxies.delete(accountId);
    if (proxy) await proxy.close();
    return;
  }
  if (idleCloseTimer) {
    clearTimeout(idleCloseTimer);
    idleCloseTimer = null;
  }
  const current = proxyPromise;
  proxyPromise = null;
  proxyStatus = { state: "idle", error: "" };
  if (!current) return;
  try {
    const proxy = await current;
    await proxy.close?.();
  } catch {}
  if (process.env.CHATGPT_EMBED_IN_UI !== "0") {
    const { closeInAppBrowser } = await import("../../window-app/in-app-browser.mjs");
    await closeInAppBrowser().catch(() => {});
  }
}

export function scheduleChatGPTBrowserIdleClose(delayMs = BROWSER_IDLE_CLOSE_MS) {
  if (idleCloseTimer) clearTimeout(idleCloseTimer);
  idleCloseTimer = null;
  // Keep the dedicated ChatGPT browser alive by default. This lets ChatGPT
  // rotate its session cookies instead of forcing a fresh login after idle.
  if (delayMs == null) return;
  idleCloseTimer = setTimeout(() => {
    idleCloseTimer = null;
    closeChatGPTBrowserProxy().catch(() => {});
  }, Math.max(5_000, Number(delayMs) || 5_000));
  idleCloseTimer.unref?.();
}

export async function resetChatGPTBrowserProxy(accountId = "default") {
  await closeChatGPTBrowserProxy(accountId);
}

export function getChatGPTBrowserProxy(options = {}) {
  const { debug = false, accountId = "default" } = options;
  if (accountId !== "default") {
    if (!accountProxies.has(accountId)) accountProxies.set(accountId, backgroundBrowserPool.proxy("chatgpt:" + accountId, () => createProxy(options), ["sendChat"]));
    return Promise.resolve(accountProxies.get(accountId));
  }
  if (idleCloseTimer) {
    clearTimeout(idleCloseTimer);
    idleCloseTimer = null;
  }
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

export function getChatGPTAccountLaunchConfig({ accountId = "default", authFile = CHATGPT_AUTH_FILE, profileDir = CHATGPT_BROWSER_PROFILE } = {}) {
  return { accountId, authFile, profileDir, embedUi: accountId === "default" && process.env.CHATGPT_EMBED_IN_UI === "1" };
}

async function createProxy(options) {
  const { accountId, profileDir } = getChatGPTAccountLaunchConfig(options);
  return withAccountActivitySession('chatgpt', accountId, () =>
    withAccountActivitySession('chatgpt', profileActivityId(profileDir), () => createProxySession(options)));
}

async function createProxySession(options) {
  const { debug = false, adoptedSession = null } = options;
  const { accountId, authFile, profileDir, embedUi } = getChatGPTAccountLaunchConfig(options);
  const chromium = await getChatGPTChromium();
  if (debug) console.log(`[chatgpt-proxy] using browser engine: ${getChatGPTEngineName()}`);

  const authState = { data: readChatGPTAuth(authFile) };
  const userAgent = authState.data?.userAgent || DEFAULT_UA;

  let context = null;
  let page = null;
  let browserSession = null;
  let sendCount = 0;
  let authPollTimer = null;
  let authWatchersAttached = false;
  let pageLifecycleAttached = false;
  const observedPages = new WeakSet();

  function observeActivePage(candidate) {
    if (!candidate || candidate.isClosed?.()) return;
    page = candidate;

    if (observedPages.has(candidate)) return;
    observedPages.add(candidate);

    candidate.on("load", () => {
      if (!authWatchersAttached) return;
      setTimeout(() => { syncAuthFromBrowser().catch(() => {}); }, 1500);
    });
    candidate.on("close", () => {
      if (page !== candidate || !context) return;
      const fallback = context.pages().filter((item) => !item.isClosed?.()).at(-1);
      if (fallback) observeActivePage(fallback);
    });
  }

  function attachPageLifecycle() {
    if (!context || pageLifecycleAttached) return;
    pageLifecycleAttached = true;
    context.on("page", (candidate) => {
      // OAuth providers commonly open a separate page. The embedded panel must
      // follow it and return to ChatGPT when that page closes.
      observeActivePage(candidate);
    });
    observeActivePage(page);
  }

  async function syncAuthFromBrowser() {
    try {
      const cookies = pickEssentialChatGPTCookies(await context.cookies());
      const sessionTokenFromCookie = getChatGPTSessionToken(cookies);

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

      if (session?.error === "RefreshAccessTokenError") {
        const withoutExpiredSession = cookies.filter((cookie) =>
          !/^(?:__Secure-)?(?:next-auth|authjs)\.session-token(?:\.\d+)?$/.test(String(cookie?.name || "")),
        );
        writeChatGPTAuth(authFile, {
          cookies: withoutExpiredSession,
          accessToken: "",
          sessionToken: "",
          profileDir,
          userAgent: authState.data?.userAgent || userAgent,
          accountIdentity: session?.user?.id || session?.user?.email || authState.data?.accountIdentity || "",
        });
        authState.data = readChatGPTAuth(authFile);
        return null;
      }

      const sessionToken = session?.sessionToken || sessionTokenFromCookie || "";
      if (!isSuccessfulChatGPTSession({ ...session, sessionToken })) return null;
      const accessToken = session?.accessToken || "";

      const ua = await page.evaluate(() => navigator.userAgent).catch(() => userAgent);
      writeChatGPTAuth(authFile, {
        cookies,
        accessToken,
        sessionToken,
        profileDir,
        userAgent: ua,
        accountIdentity: session?.user?.id || session?.user?.email || authState.data?.accountIdentity || "",
      });
      authState.data = readChatGPTAuth(authFile);
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
    if (!force && page && !page.isClosed?.()) {
      const currentUrl = page.url();
      if (/^https?:/i.test(currentUrl) && !/https?:\/\/([^/]+\.)?chatgpt\.com(?:[/:]|$)/i.test(currentUrl)) {
        return false;
      }
      const currentState = await detectCloudflareChallenge(page).catch(() => null);
      if (currentState?.loginRequired) return false;
    }
    const raw = await context.cookies().catch(() => []);
    const essential = pickEssentialChatGPTCookies(raw);
    const rawBytes = estimateCookieHeaderBytes(raw);
    const shouldPrune = force || raw.length > 28 || rawBytes > 7000 || essential.length < raw.length;
    if (!shouldPrune) return false;

    await clearBrowserCookiesViaCdp(page, context);
    if (essential.length) {
      await applyCookiesToContext(context, essential);
    }
    writeChatGPTAuth(authFile, {
      cookies: essential,
      accessToken: authState.data?.accessToken || "",
      sessionToken: authState.data?.sessionToken || "",
      profileDir,
      userAgent: authState.data?.userAgent || userAgent,
      accountIdentity: authState.data?.accountIdentity || "",
    });
    authState.data = readChatGPTAuth(authFile);
    if (debug) {
      console.log(`[chatgpt-proxy] pruned cookies ${raw.length} → ${essential.length} (${rawBytes}B → ${estimateCookieHeaderBytes(essential)}B)`);
    }
    return true;
  }

  async function launchBrowser() {
    if (accountId !== "default") {
      browserSession = await launchInternalBrowserContext(chromium, profileDir, { headless: true, userAgent });
      return { ctx: browserSession.context, pg: browserSession.page };
    }
    const launch = getChatGPTLaunchProfile();

    if (launch.useExternalChrome && !embedUi) {
      if (!browserSession && killStaleChromeForProfile(profileDir)) {
        await sleep(1200);
      }
      fs.mkdirSync(profileDir, { recursive: true });
      cleanupProfileLocks(profileDir);

      browserSession = await launchNormalChromeForChatGPT(chromium, profileDir, {
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
        const restored = await restoreSavedChatGPTCookiesIfMissing(ctx, authState.data.cookies);
        if (restored) {
          await pg.reload({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
          if (debug) console.log("[chatgpt-proxy] restored missing session cookies from auth.json");
        }
      } catch (e) {
        if (debug) console.error(`[chatgpt-proxy] failed to restore saved cookies (continuing): ${e.message}`);
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
    attachPageLifecycle();
    if (debug) console.log("[chatgpt-proxy] adopted login browser — окно остаётся открытым");
    await syncAuthFromBrowser();
  } else {
    const r = await launchBrowser();
    context = r.ctx;
    page = r.pg;
    attachPageLifecycle();
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
    const state = await detectCloudflareChallenge(page);
    const url = page.url();
    if (/^https?:/i.test(url) && !/https?:\/\/([^/]+\.)?chatgpt\.com(?:[/:]|$)/i.test(url)) {
      return { ...state, url, hasComposer: false, loginRequired: true };
    }
    return { ...state, url };
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
    for (const selector of CHATGPT_COMPOSER_SELECTORS) {
      const matches = page.locator(selector);
      const count = await matches.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const locator = matches.nth(index);
        const visible = await locator.isVisible().catch(() => false);
        const enabled = visible && await locator.isEnabled().catch(() => false);
        if (enabled) return locator;
      }
    }
    return null;
  }

  async function getComposer() {
    const deadline = Date.now() + COMPOSER_TIMEOUT_MS;
    let reloaded = false;
    const startedAt = Date.now();
    while (Date.now() < deadline) {
      const state = await detectPageState();
      if (!state.loginRequired) {
        const found = await findComposerLocator();
        if (found) return found;
      } else if (Date.now() - startedAt > 2500) {
        throw new Error(
          "ChatGPT: вход не завершён. Нажмите кнопку «Браузер», откройте ChatGPT, выберите учётную запись и дождитесь обычного чата. authentication",
        );
      }
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
      throw createChatGPTComposerUnavailableError();
    }
    throw new Error(
      "ChatGPT: не вижу поле ввода — похоже, не выполнен вход. Войди через кнопку авторизации. not logged in",
    );
  }

  async function readAssistantObservation() {
    return page.evaluate(() => {
      const observed = window.__aiFreeChatGPTObserver;
      if (!observed) return null;
      return {
        ...observed.state,
        version: observed.version,
        changedAt: observed.changedAt,
      };
    }).catch(() => null);
  }

  let fallbackAssistantObservation = null;

  async function waitForAssistantObservation(version, timeoutMs = GENERATION_EVENT_WATCHDOG_MS) {
    return page.evaluate(({ afterVersion, timeout }) => new Promise((resolve) => {
      const key = "__aiFreeChatGPTObserver";
      const current = window[key];
      if (!current || current.version > afterVersion) {
        resolve(current ? { ...current.state, version: current.version, changedAt: current.changedAt } : null);
        return;
      }
      let timer;
      const done = () => {
        clearTimeout(timer);
        window.removeEventListener("ai-free-chatgpt-state", onChange);
        const latest = window[key];
        resolve(latest ? { ...latest.state, version: latest.version, changedAt: latest.changedAt } : null);
      };
      const onChange = () => done();
      window.addEventListener("ai-free-chatgpt-state", onChange, { once: true });
      timer = setTimeout(done, timeout);
    }), { afterVersion: version, timeout: timeoutMs }).catch(() => null);
  }

  async function readAssistantSnapshot() {
    const observed = await readAssistantObservation();
    if (observed) {
      fallbackAssistantObservation = observed;
      return observed;
    }
    const current = await page.evaluate(({ stopSelector }) => {
      const nodes = document.querySelectorAll('[data-message-author-role="assistant"]');
      const last = nodes[nodes.length - 1];
      const md = last?.querySelector(".markdown") || last;
      const visible = (node) => Boolean(node && node.getClientRects().length);
      const composer = document.querySelector('#prompt-textarea[contenteditable="true"]');
      return {
        count: nodes.length,
        id: last?.getAttribute("data-message-id") || "",
        text: (md?.innerText || "").trim(),
        generating: [...document.querySelectorAll(stopSelector)].some(visible)
          || Boolean(last?.matches?.('[aria-busy="true"], [data-is-streaming="true"]')),
        readyForNextPrompt: visible(composer) && composer?.getAttribute("aria-disabled") !== "true",
        error: "",
      };
    }, { stopSelector: CHATGPT_GENERATION_STOP_SELECTOR }).catch(() => null);
    if (!current) return fallbackAssistantObservation;
    fallbackAssistantObservation = advanceChatGPTFallbackObservation(
      fallbackAssistantObservation,
      current,
    );
    return fallbackAssistantObservation;
  }

  async function waitForGenerationToFinish(beforeAssistant, { onText, prompt, conversationId, sentAtMs, submittedTurn, signal, check }) {
    let lastText = "";
    let sawResponse = false;
    let sawGenerating = false;
    let version = Number(beforeAssistant.version || 0);
    let lastActivityAt = Date.now();
    const startedAt = Date.now();
    const deadline = startedAt + GENERATION_TIMEOUT_MS;
    let nextSavedCheckAt = startedAt + 3_000;

    while (Date.now() < deadline) {
      check();
      signal?.throwIfAborted();
      let assistant = await waitForAssistantObservation(version);
      signal?.throwIfAborted();
      if (!assistant) {
        // A full document navigation destroys the in-page observer. Restore it
        // and continue without losing the task-level deadline.
        await installChatGPTDomObserver(page).catch(() => {});
        assistant = await readAssistantSnapshot();
      }
      if (assistant) fallbackAssistantObservation = assistant;
      const nextVersion = Number(assistant?.version || 0);
      if (nextVersion !== version) lastActivityAt = Date.now();
      version = nextVersion;

      const responseChanged = hasChatGPTResponseChanged(beforeAssistant, assistant);
      if (responseChanged) sawResponse = true;
      if (assistant?.generating) sawGenerating = true;

      const text = responseChanged ? normalizeChatGPTAssistantText(assistant?.text) : "";
      if (text && text !== lastText) {
        onText?.(text);
        lastText = text;
        lastActivityAt = Date.now();
      }

      if (Date.now() >= nextSavedCheckAt) {
        nextSavedCheckAt = Date.now() + 5_000;
        const currentConversationId = submittedTurn.conversationId || /\/c\/([0-9a-fA-F-]+)/.exec(page.url())?.[1] || conversationId;
        const saved = await findChatGPTSavedResponse({
          accessToken: authState.data?.accessToken,
          cookies: authState.data?.cookies,
          userAgent: authState.data?.userAgent || userAgent,
          prompt,
          sentAtMs,
          conversationId: currentConversationId,
          userMessageId: submittedTurn.userMessageId,
        });
        if (saved) {
          if (saved.text !== lastText) onText?.(saved.text);
          return saved;
        }
      }

      const failure = getChatGPTGenerationWaitFailure({
        elapsedMs: Date.now() - startedAt,
        sawGeneration: sawResponse || sawGenerating,
        pageError: assistant?.error,
      });
      if (failure) throw new Error(failure);

      const quietForMs = Date.now() - Number(assistant?.changedAt || lastActivityAt);
      const quietThresholdMs = sawGenerating && !assistant?.generating
        ? GENERATION_STOP_QUIET_MS
        : GENERATION_STABLE_QUIET_MS;
      const decision = getChatGPTObservationDecision({
        responseChanged,
        text: lastText,
        generating: Boolean(assistant?.generating),
        sawGenerating,
        readyForNextPrompt: Boolean(assistant?.readyForNextPrompt),
        quietForMs,
        quietThresholdMs,
      });
      if (decision.done) return null;

      if ((sawResponse || sawGenerating) && !assistant?.generating && Date.now() - lastActivityAt >= GENERATION_INACTIVITY_TIMEOUT_MS) {
        throw new Error(`ChatGPT не обновлял ответ ${Math.round(GENERATION_INACTIVITY_TIMEOUT_MS / 1000)} секунд.`);
      }
    }
    throw new Error(`ChatGPT не завершил ответ за ${Math.round(GENERATION_TIMEOUT_MS / 60_000)} минут.`);
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

  async function selectChatGPTModel(modelId) {
    const model = resolveChatGPTRequestedModel(modelId);

    const picker = page.getByTestId("model-switcher-dropdown-button").first();
    const modelSelection = resolveChatGPTModelSelection(model);
    if (modelSelection.alreadySelected) return true;
    if (!(await picker.count().catch(() => 0))) throw createChatGPTModelUnavailableError(modelId);
    const current = String(await picker.innerText().catch(() => ""));
    if (resolveChatGPTModelSelection(model, current).alreadySelected) return true;

    await picker.click({ timeout: 10_000 });
    await page.waitForTimeout(300);
    for (const label of modelSelection.labels) {
      const candidates = [
        page.getByRole("menuitem", { name: label, exact: true }),
        page.getByRole("option", { name: label, exact: true }),
        page.getByText(label, { exact: true }),
      ];
      for (const candidate of candidates) {
        const count = await candidate.count().catch(() => 0);
        for (let index = 0; index < count; index += 1) {
          const item = candidate.nth(index);
          if (!(await item.isVisible().catch(() => false))) continue;
          await item.click({ timeout: 10_000 });
          await page.waitForTimeout(500);
          const selectedLabel = String(await picker.innerText().catch(() => ""));
          if (resolveChatGPTModelSelection(model, selectedLabel).alreadySelected) return true;
          throw createChatGPTModelUnavailableError(modelId);
        }
      }
    }
    await page.keyboard.press("Escape").catch(() => {});
    throw createChatGPTModelUnavailableError(modelId);
  }

  async function sendChatOnce({ prompt, model, conversationId, onText, images = [], attemptState = null, signal = null, check }) {
    signal?.throwIfAborted();
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

    signal?.throwIfAborted();
    await getComposer();
    signal?.throwIfAborted();
    await selectChatGPTModel(model);
    await installChatGPTDomObserver(page);
    const beforeAssistant = await readAssistantSnapshot();

    const tempImagePaths = images?.length ? writeTempImages(images) : [];
    let sentAtMs = 0;
    let savedAnswer = null;
    try {
      if (tempImagePaths.length) {
        await attachImages(tempImagePaths);
      }

      // Выбор модели и гидрация SPA могут заменить textarea. Ищем активное
      // поле заново и автоматически повторяем ввод при detach/disabled.
      signal?.throwIfAborted();
      await fillChatGPTComposer(page, prompt);

      const sendButton = page.locator('[data-testid="send-button"]').first();
      // С картинками ждём дольше: кнопка отправки активна только после загрузки.
      const buttonVisible = await sendButton.waitFor({
        state: "visible",
        timeout: tempImagePaths.length ? 60_000 : 5000,
      }).then(() => true, () => false);
      // A click/Enter may submit before the browser reports a navigation error.
      // Never resend an uncertain submission, including via the Enter fallback.
      signal?.throwIfAborted();
      check.beforeSend();
      if (attemptState) attemptState.promptSubmitted = true;
      sentAtMs = Date.now();
      const submittedTurn = {};
      const submitPage = page;
      const onRequest = (request) => {
        if (submittedTurn.userMessageId) return;
        const turn = getChatGPTSubmittedTurn(request);
        if (turn) Object.assign(submittedTurn, turn);
      };
      submitPage.on("request", onRequest);
      try {
        if (buttonVisible) await sendButton.click();
        else await page.keyboard.press("Enter");
        savedAnswer = await waitForGenerationToFinish(beforeAssistant, {
          onText, prompt, conversationId, sentAtMs, submittedTurn, signal, check,
        });
      } finally {
        submitPage.off("request", onRequest);
      }
    } finally {
      for (const filePath of tempImagePaths) {
        try { fs.unlinkSync(filePath); } catch {}
      }
    }

    signal?.throwIfAborted();
    const resolvedConversationId =
      savedAnswer?.conversationId || /\/c\/([0-9a-fA-F-]+)/.exec(page.url())?.[1] || conversationId || null;
    const answer = savedAnswer || await extractAssistantAnswer(resolvedConversationId);
    const domSnapshot = await readAssistantSnapshot();
    if (!savedAnswer) answer.text = selectPreferredChatGPTAssistantText(answer.text, domSnapshot?.text);
    // ChatGPT мог сгенерировать картинку (DALL·E) — переносим её к нам.
    const generatedImages = !savedAnswer || domSnapshot?.id === savedAnswer.id
      ? await extractAssistantImages()
      : [];

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
        writeChatGPTAuth(authFile, {
          cookies: authState.data.cookies,
          accessToken: session.accessToken,
          sessionToken: authState.data.sessionToken,
          profileDir,
          userAgent: authState.data.userAgent || userAgent,
          accountIdentity: authState.data?.accountIdentity || "",
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

  async function sendChat(options) {
    return browserRequestPolicies.chatgpt.observe(page, options, async check =>
      runChatGPTBrowserSend(sendChatOnce, { ...options, check,
        onText: text => { check.onText(text); options.onText?.(text); } }, async () => {
        const stop = page.locator(CHATGPT_GENERATION_STOP_SELECTOR).first();
        if (await stop.isVisible().catch(() => false)) await stop.click({ timeout: 1000 });
      }));
  }

  // Проверка, что веб-сессия жива и доступно поле ввода. Если нет — бросает
  // auth-ошибку ("not logged in"/challenge), чтобы внешний слой переоткрыл вход.
  // Делает одну перезагрузку-ретрай: лечит частые headless/Cloudflare затыки.
  async function ensureReady() {
    if (!/chatgpt\.com/.test(page.url())) {
      await gotoHome();
    }
    // getComposer already performs one timed home navigation when the SPA is
    // partially hydrated. Repeating it here doubled every failure to ~50 s.
    await getComposer();
    await syncAuthFromBrowser();
    return true;
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

    const poll = async () => {
      if (!context || page.isClosed()) return;
      // ChatGPT rotates cookies before the old session becomes unusable.
      // Save every rotation so restarts resume the newest browser session.
      await tryPersist().catch(() => {});

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
