import { backgroundBrowserPool } from "../../browser/session-pool.mjs";
// Account-owned Qwen browser session. New model turns use the site's composer;
// its original request/headers remain intact and a response clone supplies SSE.
// API fetch methods remain for chat creation, history and existing stream resume.

import { QWEN_AUTH_FILE, QWEN_BASE_URL, QWEN_BROWSER_PROFILE } from "./config.mjs";
import { applyQwenCookiesToContext, readQwenAuth, seedQwenPageToken } from "./auth-files.mjs";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { resolveQwenStreamTimeouts } from "./stream-timeouts.mjs";
import { isQwenPunishResponse, startQwenPunishCooldown, clearQwenPunishCooldown } from "./request-pacing.mjs";
import { attemptBaxiaSolveFailOpen, resolveBaxiaSolverConfig, trySolveBaxiaOnPage } from "./baxia-solver.mjs";
import { launchQwenCamoufoxSession } from "./camoufox-session.mjs";
import { submitQwenNativeTurn } from "./native-composer.mjs";
import { createQwenSessionExpiredError } from "./session-errors.mjs";
import { harvestQwenCheckpoint } from "./harvest.mjs";
import { attachQwenSupportDiagnostics, logQwenRuntimeNotReady } from './support-network.mjs';

const proxyContexts = new Map(); // accountId -> { promise }
const visibleCaptchaAccounts = new Set();
const QWEN_NAV_TIMEOUT_MS = Number(process.env.QWEN_NAV_TIMEOUT_MS || 90_000);
const QWEN_READY_DELAY_MS = Number(process.env.QWEN_READY_DELAY_MS || 45_000);
const QWEN_READY_POLL_MS = Number(process.env.QWEN_READY_POLL_MS || 100);
const QWEN_STREAM_TIMEOUTS = resolveQwenStreamTimeouts();
const QWEN_FETCH_TIMEOUT_MS = QWEN_STREAM_TIMEOUTS.fetchMs;
const QWEN_RESPONSE_HEADERS_TIMEOUT_MS = QWEN_STREAM_TIMEOUTS.responseHeadersMs;
const QWEN_STREAM_FIRST_CONTENT_TIMEOUT_MS = QWEN_STREAM_TIMEOUTS.firstContentMs;
const QWEN_STREAM_IDLE_TIMEOUT_MS = QWEN_STREAM_TIMEOUTS.idleMs;
const QWEN_PROXY_MAX_ATTEMPTS = Math.max(1, Math.min(5, Number(process.env.QWEN_PROXY_MAX_ATTEMPTS || 3)));
const QWEN_BROWSER_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.QWEN_BROWSER_CONCURRENCY || 1)));

export function isQwenRuntimeReady(diagnostics = false) {
  const status = {
    documentReady: document.readyState !== 'loading',
    appScriptPresent: Array.from(document.scripts).some(script =>
      /\/qwen-chat-fe\/[^/]+\/js\/main(?:-[\w-]+)?\.js(?:$|\?)/.test(script.src || '')),
    sdkInitialized: window.baxiaInitialized === true,
    deviceTokenPresent: false,
  };
  try { status.deviceTokenPresent = Boolean(window.__baxia__?.getFYModule?.getUidToken?.()); } catch {}
  status.ready = status.documentReady && status.appScriptPresent && status.sdkInitialized && status.deviceTokenPresent;
  return diagnostics === true ? status : status.ready;
}

export async function waitForQwenRuntime(page) {
  const wait = () => page.waitForFunction(isQwenRuntimeReady, null, {
    timeout: QWEN_READY_DELAY_MS,
    polling: Math.max(50, QWEN_READY_POLL_MS),
  });
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await wait(); return; }
    catch (error) {
      if (!/Timeout .* exceeded/i.test(String(error?.message || error))) throw error;
      failure = error;
      if (!attempt) {
        try { await page.reload({ waitUntil: 'domcontentloaded', timeout: QWEN_NAV_TIMEOUT_MS }); }
        catch (error) { failure = error; break; }
      }
    }
  }
  let runtime = null;
  try { runtime = await page.evaluate(isQwenRuntimeReady, true); } catch {}
  logQwenRuntimeNotReady(runtime);
  const missing = [];
  if (runtime?.documentReady === false) missing.push('загрузка страницы');
  if (runtime?.appScriptPresent === false) missing.push('скрипты Qwen с CDN');
  if (runtime?.sdkInitialized === false || runtime?.deviceTokenPresent === false) missing.push('служебный модуль Qwen');
  throw Object.assign(new Error('Qwen не подготовил страницу к отправке' + (missing.length ? ': ' + missing.join(', ') : '')
    + '. Проверьте доступ к chat.qwen.ai и assets.alicdn.com, настройки сети/VPN. Сохранённый вход не сброшен; запрос не отправлен.'), {
    code: 'QWEN_BROWSER_TRANSPORT_FAILURE', reason: 'QWEN_RUNTIME_NOT_READY', delivery: 'not_sent', runtime, cause: failure,
  });
}

export function hasQwenClearanceCookieHeader(cookieHeader) {
  return /(?:^|;\s*)x5sec=([^;]+)/.test(String(cookieHeader || ""));
}

export function createWorkerStreamRouter() {
  const handlers = new Map();
  return {
    bind(workerId, handler) { handlers.set(String(workerId), handler); },
    unbind(workerId) { handlers.delete(String(workerId)); },
    push(workerId, chunk) {
      const handler = handlers.get(String(workerId));
      return typeof handler === "function" && handler(chunk) === true;
    },
  };
}

export function isTransientBrowserError(error) {
  const message = String(error?.message || error || "");
  return /Execution context was destroyed|most likely because of a navigation|Target closed|Page closed|Context closed|Timeout .* exceeded|qwen_page_evaluate_timeout|net::ERR_ABORTED|NS_BINDING_ABORTED|NS_ERROR_NET_TIMEOUT|Failed to fetch|request is finished/i.test(message);
}

// Only unfinished model POSTs count as a live original transport.
export function createQwenCompletionTracker() {
  const requests = new Map();
  return {
    attach(page) {
      const pending = new Set();
      requests.set(page, pending);
      page.on("request", request => {
        if (request.method() === "POST" && /^https:\/\/chat\.qwen\.ai\/api\/v2\/chat\/completions(?:$|\?)/.test(request.url())) pending.add(request);
      });
      page.on("requestfinished", request => pending.delete(request));
      page.on("requestfailed", request => pending.delete(request));
      page.on("close", () => requests.delete(page));
    },
    pending() { return [...requests.values()].reduce((total, requests) => total + requests.size, 0); },
  };
}

export function watchQwenPunishNavigation(page, { isActive = () => true } = {}) {
  let resolve;
  let disposed = false;
  const promise = new Promise((done) => { resolve = done; });
  const onRequest = async (request) => {
    const url = new URL(request.url());
    if (url.origin !== 'https://chat.qwen.ai'
      || !/^\/+api\/v2\/chat\/completions\/_____tmd_____\/punish(?:\/|$)/.test(url.pathname)) return;
    if (!await Promise.resolve().then(isActive).catch(() => false) || disposed) return;
    resolve({ ok: false, status: 0, contentType: "", text: "_____tmd_____/punish", punish: true });
  };
  page.on("request", onRequest);
  return { promise, dispose: () => { disposed = true; page.off("request", onRequest); } };
}

export async function runQwenNativeTurnWithChallenge({ submit, challenge, solve, recover, signal }) {
  signal?.throwIfAborted();
  const native = submit();
  const outcome = await Promise.race([
    native.then(result => ({ result })),
    challenge.then(result => ({ challenge: result })),
  ]);
  signal?.throwIfAborted();
  const challenged = outcome.challenge || (isQwenPunishResponse(outcome.result) ? outcome.result : null);
  if (!challenged) return outcome.result;
  const solved = await solve();
  signal?.throwIfAborted();
  // Baxia replays its own pending fetch. Keep that capture alive; never POST again.
  if (!solved) return challenged;
  return recover ? await Promise.race([native, recover().then(result => result || native)]) : await native;
}

// Firefox can report NS_BINDING_ABORTED when Qwen redirects during goto,
// even though the target document has loaded. This happens before any POST.
export async function navigateQwenPage(page, url) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: QWEN_NAV_TIMEOUT_MS });
      return;
    } catch (error) {
      // Navigation precedes dispatch. A failed load cannot have sent this turn.
      if (isTransientBrowserError(error)) {
        error.code = "QWEN_BROWSER_TRANSPORT_FAILURE";
        error.delivery = "not_sent";
      }
      if (!/NS_BINDING_ABORTED/i.test(String(error?.message || error))) throw error;
      const loaded = await page.waitForLoadState("domcontentloaded", { timeout: 10_000 })
        .then(() => page.url() === url).catch(() => false);
      if (loaded) return;
      if (attempt === 1) throw error;
    }
  }
}

function isClosedBrowserError(error) {
  const message = String(error?.message || error || "");
  return /Target closed|Page closed|Context closed|Browser has been closed/i.test(message);
}

export async function primeQwenPageAuth(page, authToken, { delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (!authToken) return;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page.evaluate(seedQwenPageToken, authToken);
      return;
    } catch (error) {
      if (!/Execution context was destroyed|most likely because of a navigation/i.test(String(error?.message || error)) || attempt === 3) throw error;
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      await delay(250 * (attempt + 1));
    }
  }
}

function hashChatId(chatId) {
  let hash = 0;
  for (const ch of String(chatId || "")) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

// Сброс singleton после re-login / refresh — следующий запрос поднимет прокси с новыми куками.
export async function closeQwenBrowserProxy(accountId = null) {
  if (accountId) {
    visibleCaptchaAccounts.delete(accountId);
    const entry = proxyContexts.get(accountId);
    if (entry) {
      proxyContexts.delete(accountId);
      try { const proxy = await entry.promise; await proxy.close?.(); } catch {}
      await backgroundBrowserPool.pin(`qwen:${accountId}`, false);
    }
    return;
  }
  for (const [id, entry] of proxyContexts.entries()) {
    try { const proxy = await entry.promise; await proxy.close?.(); } catch {}
  }
  for (const id of proxyContexts.keys()) await backgroundBrowserPool.pin(`qwen:${id}`, false);
  proxyContexts.clear();
  visibleCaptchaAccounts.clear();
}

export function resetQwenBrowserProxy(accountId = null) {
  if (accountId && visibleCaptchaAccounts.has(accountId)) return Promise.resolve();
  return closeQwenBrowserProxy(accountId);
}

// Возвращает singleton-инстанс прокси. Все вызовы делят одну сессию Camoufox.
export function getQwenBrowserProxy({ accountId = 'default', debug = false } = {}) {
  if (!proxyContexts.has(accountId)) {
    const p = Promise.resolve(backgroundBrowserPool.proxy(`qwen:${accountId}`,
      () => createProxy({ accountId, debug, visible: false }),
      ['pendingCompletionRequests', 'submitNativeTurn', 'saveCurrentAuth', 'captchaPage', 'showCaptchaWindow', 'hasCaptchaClearance', 'proxyFetch', 'proxyFetchStream', 'proxyApiPost', 'proxyApiGet']));
    proxyContexts.set(accountId, { promise: p });
  }
  return proxyContexts.get(accountId).promise;
}

export function qwenPageNeedsLogin() {
  return Array.from(document.querySelectorAll('button, a, [role="button"]')).some(element =>
    element.getClientRects().length > 0 && /^(?:Войти|Sign in|Log in|Login|登录)$/i.test(String(element.innerText || element.textContent || '').trim()));
}

// Baxia leaves its iframe in a hidden container after manual verification.
export function isQwenChallengeVisible() {
  if (location.pathname.includes('/_____tmd_____/punish')) return true;
  return Array.from(document.querySelectorAll("#baxia-dialog-content, iframe[src*='_____tmd_____']")).some(element => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.x + rect.width <= 0 || rect.y + rect.height <= 0
      || rect.x >= window.innerWidth || rect.y >= window.innerHeight) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)
        || parseFloat(style.opacity) === 0) return false;
    }
    return true;
  });
}

export async function ensureQwenNativeSession(page, { signal } = {}) {
  signal?.throwIfAborted();
  try {
    await page.locator('textarea.message-input-textarea').waitFor({ state: 'visible', timeout: 15_000 });
  } catch (error) {
    signal?.throwIfAborted();
    if (error.name !== 'TimeoutError') throw error;
    throw Object.assign(new Error('Qwen ещё не загрузил чат. Сохранённая сессия не сброшена; запрос не отправлен.'), {
      code: 'QWEN_BROWSER_TRANSPORT_FAILURE', delivery: 'not_sent', cause: error,
    });
  }
  signal?.throwIfAborted();
  let needsLogin = await page.evaluate(qwenPageNeedsLogin);
  let hasValidToken = false;
  if (needsLogin) {
    hasValidToken = await page.evaluate(() => {
      try {
        const token = localStorage.getItem('token') || '';
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        return Number.isFinite(payload.exp) && payload.exp * 1000 > Date.now();
      } catch { return false; }
    });
    // The SSR guest header can precede the authenticated user response.
    for (let attempt = 0; needsLogin && hasValidToken && attempt < 10; attempt++) {
      signal?.throwIfAborted();
      try {
        await page.waitForFunction(() => !Array.from(document.querySelectorAll('button, a, [role="button"]')).some(element =>
          element.getClientRects().length > 0 && /^(?:Войти|Sign in|Log in|Login|登录)$/i.test(String(element.innerText || element.textContent || '').trim())),
        null, { timeout: 1000, polling: 100 });
      } catch (error) { if (error.name !== 'TimeoutError') throw error; }
      signal?.throwIfAborted();
      needsLogin = await page.evaluate(qwenPageNeedsLogin);
    }
  }
  signal?.throwIfAborted();
  if (needsLogin && hasValidToken) {
    throw Object.assign(new Error('Qwen не подтвердил загрузку авторизованного чата. Сохранённая сессия не сброшена; запрос не отправлен.'), {
      code: 'QWEN_BROWSER_TRANSPORT_FAILURE', delivery: 'not_sent',
    });
  }
  if (needsLogin) {
    throw Object.assign(createQwenSessionExpiredError({ code: 'session_expired',
      details: 'Штатный интерфейс Qwen требует входа.', context: 'Qwen composer' }), { delivery: 'not_sent' });
  }
}

// Serialized into the account's own page; do not export credentials to Node.
export async function qwenApiGetInPage({ path, timeoutMs, authToken = '' }) {
  const url = new URL(path, window.location.href);
  if (url.origin !== 'https://chat.qwen.ai' || url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
    throw new Error('Qwen: история доступна только через API текущего сайта.');
  }
  const headers = { accept: 'application/json, text/plain, */*', source: 'web' };
  let token = authToken;
  try { token = localStorage.getItem('token') || token; } catch {}
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('qwen_fetch_timeout'), timeoutMs);
  try {
    const res = await fetch(`${url.pathname}${url.search}`, { method: 'GET', headers, credentials: 'include', signal: controller.signal });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } finally { clearTimeout(timeoutId); }
}

export async function openQwenCaptchaBrowser(accountId = 'default') {
  visibleCaptchaAccounts.add(accountId);
  backgroundBrowserPool.pin(`qwen:${accountId}`, true);
  try {
    const proxy = await getQwenBrowserProxy({ accountId });
    return await proxy.showCaptchaWindow();
  } catch (error) {
    visibleCaptchaAccounts.delete(accountId);
    await backgroundBrowserPool.pin(`qwen:${accountId}`, false);
    throw error;
  }
}

export async function getQwenCaptchaPage(accountId = 'default') {
  if (!visibleCaptchaAccounts.has(accountId) || !proxyContexts.has(accountId)) return null;
  const proxy = await getQwenBrowserProxy({ accountId });
  return proxy.captchaPage();
}

// Reuse only an existing browser; this must never launch another login window.
export async function refreshQwenAuthFromOpenBrowser(accountId = 'default') {
  const entry = proxyContexts.get(accountId);
  if (!entry) return null;
  const proxy = await entry.promise;
  return proxy.saveCurrentAuth();
}

export async function confirmQwenCaptchaProxy(proxy, chatId) {
  const state = await proxy.showCaptchaWindow();
  if (state.loginRequired || state.challengeVisible) return false;
  if (await proxy.hasCaptchaClearance()) return true;
  if (!chatId) return false;
  const result = await proxy.proxyApiGet({ path: `/api/v2/chats/${encodeURIComponent(chatId)}?direction=up&limit=1`, chatId });
  return result.ok === true && result.json?.success !== false
    && Array.isArray(result.json?.data?.chat?.messages ?? result.json?.data?.messages);
}

export async function finishQwenCaptchaBrowser(accountId = 'default', { chatId } = {}) {
  const proxy = await getQwenBrowserProxy({ accountId });
  if (!await confirmQwenCaptchaProxy(proxy, chatId)) return false;
  await proxy.saveCurrentAuth();
  clearQwenPunishCooldown(accountId);
  visibleCaptchaAccounts.delete(accountId);
  await backgroundBrowserPool.pin(`qwen:${accountId}`, false);
  return true;
}

async function createProxy({ accountId, debug, visible = false }) {
  if (debug) console.log("[qwen-proxy] launching Camoufox with account state…");

  const pathMod = await import('node:path');
  const baseProfile = QWEN_BROWSER_PROFILE;
  let profileDir = accountId === 'default' ? baseProfile : pathMod.resolve(baseProfile, '..', `qwen-profile-${accountId}`);
  if (accountId !== 'default') {
    try {
      const { loadAccounts } = await import('./account-store.mjs');
      const account = loadAccounts().find(account => account.id === accountId);
      if (account?.profileDir) profileDir = account.profileDir;
    } catch {}
  }
  const session = await launchQwenCamoufoxSession(profileDir, !visible);
  try {
  const context = session.context;
  const firstPage = session.page;
  const recentRequestFailures = [];

  const completionTracker = createQwenCompletionTracker();
  function attachPageDiagnostics(page, label) {
    completionTracker.attach(page);
    attachQwenSupportDiagnostics(page);
    page.on("requestfailed", (request) => {
      const requestUrl = request.url();
      if (!requestUrl.startsWith(QWEN_BASE_URL)) return;
      const failure = request.failure();
      recentRequestFailures.push({
        url: requestUrl,
        method: request.method(),
        errorText: failure?.errorText || "unknown",
        ts: Date.now(),
      });
      if (recentRequestFailures.length > 20) recentRequestFailures.shift();
      if (debug) {
        console.log(`[qwen-proxy:${label}:requestfailed] ${request.method()} ${requestUrl}: ${failure?.errorText || "unknown"}`);
      }
    });
  }

  attachPageDiagnostics(firstPage, "page0");

  /**
   * Попытка решить Baxia punish-слайдер на странице воркера.
   * Возвращает true при успехе (x5sec установлен, кулдаун снят).
   * Любая ошибка проглатывается — фоллбэком остаётся punish-кулдаун.
   */
  const trySolvePunishOnWorker = async (worker, pathLabel, signal) => {
    const cfg = resolveBaxiaSolverConfig();
    return attemptBaxiaSolveFailOpen({
      enabled: cfg.enabled,
      signal,
      solve: () => trySolveBaxiaOnPage(worker.page, cfg, {
        signal,
        confirm: () => worker.page.evaluate(isQwenChallengeVisible).then(visible => !visible),
        log: (msg) => console.warn(`[qwen-proxy:${worker.label}] baxia-solver(${pathLabel}): ${msg}`),
      }),
      clearCooldown: () => clearQwenPunishCooldown(accountId),
      log: (msg) => console.warn(`[qwen-proxy:${worker.label}] baxia-solver(${pathLabel}): ${msg} — fallback to cooldown`),
    });
  };

  const streamRouter = createWorkerStreamRouter();
  const nativeTurns = new Map();
  await context.exposeFunction("__qwenRawStreamChunk", async (workerId, chunk) => {
    return streamRouter.push(workerId, chunk);
  });
  await context.exposeFunction('__qwenNativeBootstrap', (workerId, info) => {
    const turn = nativeTurns.get(workerId);
    if (!turn || !turn.allowNativeRootChat || turn.parentId != null || info?.previousChatId !== turn.chatId
      || typeof info.chatId !== 'string' || !info.chatId.trim()) return false;
    turn.bootstrap = info;
    return true;
  });

  // auth.json может быть свежее профиля (import-qwen, silent refresh). Подмешиваем куки до goto.
  let authToken = "";
  let cookiesToInject = [];
  if (accountId !== 'default') {
    const { loadAccounts } = await import("./account-store.mjs");
    const account = loadAccounts().find(account => account.id === accountId);
    authToken = account?.token || "";
    cookiesToInject = account?.cookies || [];
  } else {
    const { loadAccounts } = await import("./account-store.mjs");
    const savedAuth = loadAccounts().find(account => account.id === 'default') || readQwenAuth(QWEN_AUTH_FILE);
    authToken = savedAuth?.token || "";
    cookiesToInject = savedAuth?.cookies || [];
  }
  if (cookiesToInject.length) {
    const n = await applyQwenCookiesToContext(context, cookiesToInject, { preserveSession: true });
    if (debug) console.log(`[qwen-proxy:${accountId}] injected ${n} cookies`);
  }

  // Qwen may redirect immediately after goto. Seed each new document before
  // its app scripts run, so auth does not depend on a racing page.evaluate.
  if (authToken) {
    await context.addInitScript(seedQwenPageToken, authToken);
  }

  const primePageAuth = (page) => primeQwenPageAuth(page, authToken);

  if (debug) {
    // Фильтр шума: console.groupEnd с именем «Error» из Qwen-овского JS (это
    // просто метка группы, не реальная ошибка), Mixed Content для favicon,
    // ERR_CONNECTION_REFUSED на 127.0.0.1, WebGL GPU stall, APLUS init и т.п.
    const SUPPRESS_PATTERNS = [
      /^endGroup:/,                  // console.groupEnd с любым лейблом — это закрытие группы
      /^clear:/,                     // console.clear
      /^debug: Error$/,              // именно строка «debug: Error» — внутренний маркер
      /Mixed Content.*favicon/i,
      /ERR_CONNECTION_REFUSED.*127\.0\.0\.1/i,
      /Failed to load resource:.*favicon/i,
      /Failed to load resource:.*net::ERR_/i,
      /GPU stall due to ReadPixels/i,
      /APLUS INIT SUCCESS/i,
      /Browser detection:/i,
      /Modern features support:/i,
      /^log:\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s/, // голые таймстампы из их JS
    ];
    firstPage.on("console", (msg) => {
      const text = `${msg.type()}: ${msg.text()}`;
      if (SUPPRESS_PATTERNS.some((re) => re.test(text))) return;
      console.log(`[qwen-proxy:console] ${text}`);
    });
    firstPage.on("pageerror", (err) => {
      // indexedDB.open ошибки на headless безобидны — это известная проблема persistent context.
      if (/indexedDB\.open/i.test(err.message)) return;
      console.error(`[qwen-proxy:pageerror] ${err.message}`);
    });
  }

  const workers = [{ page: firstPage, currentChatId: null, queue: Promise.resolve(), label: "page0" }];
  for (let i = 1; i < QWEN_BROWSER_CONCURRENCY; i += 1) {
    const page = await context.newPage();
    attachPageDiagnostics(page, `page${i}`);
    workers.push({ page, currentChatId: null, queue: Promise.resolve(), label: `page${i}` });
  }

  await Promise.all(workers.map(async (worker) => {
    await navigateQwenPage(worker.page, QWEN_BASE_URL);
    await primePageAuth(worker.page);
    // Даём JS-бандлу проинициализировать перехватчик fetch / bx-ua (на слабых сетях 1-2 сек мало).
    await waitForQwenRuntime(worker.page);
  }));

  if (debug) console.log(`[qwen-proxy] ready (${workers.length} page${workers.length === 1 ? "" : "s"})`);

  let nextWorkerIndex = 0;

  // Graceful shutdown при завершении процесса.
  const close = async () => {
    process.removeListener("exit", onExit);
    try {
      await Promise.all(workers.map((worker) => worker.queue.catch(() => {})));
      await session.close();
    } catch {}
  };
  const onExit = () => { close(); };
  process.once("exit", onExit);

  // Навигация на /c/<chatId>. Это, похоже, ЕДИНСТВЕННЫЙ способ зарегистрировать
  // chat_id на сервере Qwen — после goto JS-бандл сам делает скрытую синхронизацию
  // (WebSocket / late POST), и сервер начинает принимать /completions для этого id.
  async function ensureChatPage(worker, chatId, { force = false } = {}) {
    if (!force && worker.currentChatId === chatId) return;
    if (debug) console.log(`[qwen-proxy:${worker.label}] navigating to /c/${chatId}`);
    await navigateQwenPage(worker.page, chatId == null ? QWEN_BASE_URL : `${QWEN_BASE_URL}/c/${encodeURIComponent(chatId)}`);
    await primePageAuth(worker.page);
    // Подождём, пока SPA доделает свою регистрацию и поднимет антибот-перехватчики.
    await waitForQwenRuntime(worker.page);
    worker.currentChatId = chatId;
  }

  function latestFailureFor(requestUrl) {
    for (let i = recentRequestFailures.length - 1; i >= 0; i -= 1) {
      const item = recentRequestFailures[i];
      if (item.url === requestUrl) return item;
    }
    return null;
  }

  function pickWorker(chatId) {
    if (chatId) return workers[hashChatId(chatId) % workers.length];
    const worker = workers[nextWorkerIndex % workers.length];
    nextWorkerIndex += 1;
    return worker;
  }

  function enqueue(worker, fn) {
    const run = worker.queue.then(fn, fn);
    worker.queue = run.catch(() => {});
    return run;
  }

  async function recreateWorkerPage(worker) {
    try { await worker.page?.close?.(); } catch {}
    worker.currentChatId = null;
    const page = await context.newPage();
    attachPageDiagnostics(page, worker.label);
    worker.page = page;
    await reloadWorker(worker);
  }

  async function reloadWorker(worker) {
    worker.currentChatId = null;
    await navigateQwenPage(worker.page, QWEN_BASE_URL);
    await primePageAuth(worker.page);
    await waitForQwenRuntime(worker.page);
  }

  async function runProxyFetch(worker, { url, body, chatId, timeoutMs, streamIdleTimeoutMs, maxAttempts, beforeSend }) {
    let result = null;
    let lastError = null;
    const fetchTimeoutMs = Number(timeoutMs || QWEN_FETCH_TIMEOUT_MS);
    const idleTimeoutMs = Number(streamIdleTimeoutMs || QWEN_STREAM_IDLE_TIMEOUT_MS);
    const attempts = Math.max(1, Math.min(5, Number(maxAttempts || QWEN_PROXY_MAX_ATTEMPTS)));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        if (chatId) await ensureChatPage(worker, chatId);
          await beforeSend?.();
        const requestId = randomUUID();
        const isCompletionRequest = /\/api\/v2\/chat\/completions(?:$|\?)/.test(url);
        const accept = isCompletionRequest
          ? "application/json"
          : "application/json, text/plain, */*";
        result = await Promise.race([
          worker.page.evaluate(
            async ({ url, body, fetchTimeoutMs, streamIdleTimeoutMs, requestId, accept, isCompletionRequest, authToken }) => {
              const requestUrl = new URL(url);
              const sameOrigin = requestUrl.origin === window.location.origin;
              const fetchUrl = sameOrigin ? `${requestUrl.pathname}${requestUrl.search}` : url;
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort("qwen_fetch_timeout"), fetchTimeoutMs);
              const readWithTimeout = (reader, timeoutMs) =>
                Promise.race([
                  reader.read(),
                  new Promise((_, reject) => setTimeout(() => reject(new Error("qwen_stream_idle_timeout")), timeoutMs)),
                ]);
              const readTextBody = async (res) => {
                const contentType = res.headers.get("content-type") || "";
                if (!res.body?.getReader) {
                  return { text: await res.text(), contentType };
                }
                const isStreamingResponse = /text\/event-stream|application\/x-ndjson|stream/i.test(contentType);
                const isHtmlResponse = /text\/html/i.test(contentType);
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let text = "";
                try {
                  while (true) {
                    let chunk;
                    try {
                      chunk = await readWithTimeout(reader, streamIdleTimeoutMs);
                    } catch (error) {
                      if (String(error?.message || error) === "qwen_stream_idle_timeout" && text) break;
                      throw error;
                    }
                    const { done, value } = chunk;
                    if (done) break;
                    text += decoder.decode(value, { stream: true });
                    if (isHtmlResponse && text) {
                      try { await reader.cancel(); } catch {}
                      break;
                    }
                    if (isStreamingResponse && /(^|\n)data:\s*\[DONE\](\n|$)/.test(text)) {
                      try { await reader.cancel(); } catch {}
                      break;
                    }
                  }
                  text += decoder.decode();
                } finally {
                  try { reader.releaseLock(); } catch {}
                }
                return { text, contentType };
              };
              try {
                const headers = {
                  "Content-Type": "application/json",
                  Accept: accept,
                  source: "web",
                  "x-request-id": requestId,
                  Referer: window.location.href,
                  timezone: new Date().toString().replace(/\s*\(.+\)$/, ""),
                };
                const clientScript = Array.from(document.scripts)
                  .map((script) => script.src)
                  .find((src) => /\/qwen-chat-fe\/[^/]+\/js\/main\.js(?:$|\?)/.test(src));
                const clientVersion = clientScript?.match(/\/qwen-chat-fe\/([^/]+)\//)?.[1];
                if (clientVersion) headers.version = clientVersion;
                if (isCompletionRequest) headers["x-accel-buffering"] = "no";
                try {
                  const token = localStorage.getItem("token") || authToken || "";
                  if (token) headers.Authorization = `Bearer ${token}`;
                } catch {}
                const res = await fetch(fetchUrl, {
                  method: "POST",
                  headers,
                  body,
                  credentials: "include",
                  signal: controller.signal,
                });
                const { text, contentType } = await readTextBody(res);
                return {
                  ok: res.ok,
                  status: res.status,
                  retryAfter: res.headers.get("retry-after"),
                  contentType,
                  text,
                };
              } catch (e) {
                return {
                  ok: false,
                  status: 0,
                  contentType: "",
                  text:
                    `__fetch_error__: ${e.name || "Error"}: ${e.message}\n` +
                    `page=${window.location.href}\n` +
                    `request=${fetchUrl}`,
                };
              } finally {
                clearTimeout(timeoutId);
              }
            },
            { url, body, fetchTimeoutMs, streamIdleTimeoutMs: idleTimeoutMs, requestId, accept, isCompletionRequest, authToken },
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("qwen_page_evaluate_timeout")), fetchTimeoutMs + 5000),
          ),
        ]);
        if (result.status !== 0 || attempt === attempts - 1) break;
        if (debug) console.log(`[qwen-proxy:${worker.label}] fetch failed before HTTP response; reloading page and retrying`);
        await reloadWorker(worker);
      } catch (error) {
        lastError = error;
        if (!isTransientBrowserError(error) || attempt === attempts - 1) throw error;
        if (debug) console.log(`[qwen-proxy:${worker.label}] transient browser error; reloading page and retrying: ${error.message}`);
        try {
          if (isClosedBrowserError(error)) await recreateWorkerPage(worker);
          else await reloadWorker(worker);
        } catch (recoverError) {
          proxyContexts.delete(accountId);
      await backgroundBrowserPool.pin(`qwen:${accountId}`, false);
          throw recoverError;
        }
      }
    }
    if (!result && lastError) throw lastError;
    if (result.status === 0) {
      const failure = latestFailureFor(url);
      if (failure) {
        result.text += `\nnetwork=${failure.errorText}\nnetworkMethod=${failure.method}`;
      }
    }
    // Baxia punish (антибот-капча): детект по contentType/text и включение
    // кулдауна, чтобы выше по стеку не долбить новыми запросами.
    if (/\/api\/v2\/chat\/completions(?:$|\?)/.test(url) && isQwenPunishResponse(result)) {
      const solved = await trySolvePunishOnWorker(worker, "text");
      if (solved) {
        console.warn(`[qwen-proxy:${worker.label}] Baxia slider solved (text path) — cooldown cleared`);
      } else {
        const { backoffMs } = startQwenPunishCooldown(Date.now(), accountId);
        result = { ...result, ok: false, punish: true };
        console.warn(`[qwen-proxy:${worker.label}] Baxia punish detected — cooldown ${Math.round(backoffMs / 1000)}s (see browser window to solve captcha)`);
      }
    }
    return result;
  }

  async function runProxyFetchStream(worker, { url, body, chatId, onRawChunk, timeoutMs, streamFirstContentTimeoutMs, streamIdleTimeoutMs, maxAttempts, beforeSend }) {
    let result = null;
    let lastError = null;
    const fetchTimeoutMs = Number(timeoutMs || QWEN_FETCH_TIMEOUT_MS);
    const responseHeadersTimeoutMs = Math.min(fetchTimeoutMs, QWEN_RESPONSE_HEADERS_TIMEOUT_MS);
    const firstContentTimeoutMs = Number(streamFirstContentTimeoutMs || QWEN_STREAM_FIRST_CONTENT_TIMEOUT_MS);
    const idleTimeoutMs = Number(streamIdleTimeoutMs || QWEN_STREAM_IDLE_TIMEOUT_MS);
    const attempts = Math.max(1, Math.min(5, Number(maxAttempts || QWEN_PROXY_MAX_ATTEMPTS)));
    // Признак того, что сервер уже начал отдавать SSE-чанки. Если после этого
    // fetch умер (status 0 / abort), повторный POST того же body создал бы
    // sibling-ветку в дереве сообщений и дублировал текст — вместо этого
    // обрыв уходит наверх, и клиент восстанавливает стрим по response_id.
    let sawRawChunk = false;
    const rawStreamHandler = typeof onRawChunk === "function"
      ? (chunk) => {
        sawRawChunk = true;
        return onRawChunk(chunk);
      }
      : null;
    streamRouter.bind(worker.label, rawStreamHandler);
    try {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          if (chatId) await ensureChatPage(worker, chatId);
          await beforeSend?.();
          const requestId = randomUUID();
          const isCompletionRequest = /\/api\/v2\/chat\/completions(?:$|\?)/.test(url);
          const accept = isCompletionRequest
            ? "application/json"
            : "application/json, text/plain, */*";
          sawRawChunk = false;
          const challengeWatch = watchQwenPunishNavigation(worker.page);
          try {
            result = await Promise.race([
            worker.page.evaluate(
            async ({ url, body, fetchTimeoutMs, responseHeadersTimeoutMs, streamFirstContentTimeoutMs, streamIdleTimeoutMs, requestId, accept, isCompletionRequest, authToken, workerId }) => {
                const requestUrl = new URL(url);
                const sameOrigin = requestUrl.origin === window.location.origin;
                const fetchUrl = sameOrigin ? `${requestUrl.pathname}${requestUrl.search}` : url;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort("qwen_fetch_timeout"), fetchTimeoutMs);
                const readWithTimeout = (reader, timeoutMs) =>
                  Promise.race([
                    reader.read(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("qwen_stream_idle_timeout")), timeoutMs)),
                  ]);
                const readTextBody = async (res) => {
                  const contentType = res.headers.get("content-type") || "";
                  if (!res.body?.getReader) {
                    const text = await res.text();
                    if (text) await window.__qwenRawStreamChunk(workerId, text);
                    return { text, contentType };
                  }
                  const isStreamingResponse = /text\/event-stream|application\/x-ndjson|stream/i.test(contentType);
                  const isHtmlResponse = /text\/html/i.test(contentType);
                  const reader = res.body.getReader();
                  const decoder = new TextDecoder();
                  let text = "";
                  let hasMeaningfulContent = false;
                  const firstContentDeadline = Date.now() + streamFirstContentTimeoutMs;
                  try {
                    while (true) {
                      let chunk;
                      try {
                        chunk = await readWithTimeout(
                          reader,
                          hasMeaningfulContent
                            ? streamIdleTimeoutMs
                            : Math.max(1, firstContentDeadline - Date.now()),
                        );
                      } catch (error) {
                        if (!hasMeaningfulContent && String(error?.message || error) === "qwen_stream_idle_timeout") {
                          error = new Error("qwen_stream_first_content_timeout");
                        }
                        try { await reader.cancel(error?.message || "qwen_stream_timeout"); } catch {}
                        try { controller.abort(error?.message || "qwen_stream_timeout"); } catch {}
                        if (String(error?.message || error) === "qwen_stream_idle_timeout" && hasMeaningfulContent) break;
                        throw error;
                      }
                      const { done, value } = chunk;
                      if (done) break;
                      const piece = decoder.decode(value, { stream: true });
                      text += piece;
                      if (piece && await window.__qwenRawStreamChunk(workerId, piece)) hasMeaningfulContent = true;
                      if (isHtmlResponse && text) {
                        try { await reader.cancel(); } catch {}
                        break;
                      }
                      if (isStreamingResponse && /(^|\n)data:\s*\[DONE\](\n|$)/.test(text)) {
                        try { await reader.cancel(); } catch {}
                        break;
                      }
                    }
                    const tail = decoder.decode();
                    if (tail) {
                      text += tail;
                      if (await window.__qwenRawStreamChunk(workerId, tail)) hasMeaningfulContent = true;
                    }
                  } finally {
                    try { reader.releaseLock(); } catch {}
                  }
                  return { text, contentType };
                };
                try {
                  const headers = {
                    "Content-Type": "application/json",
                    Accept: accept,
                    source: "web",
                    "x-request-id": requestId,
                    Referer: window.location.href,
                    timezone: new Date().toString().replace(/\s*\(.+\)$/, ""),
                  };
                  const clientScript = Array.from(document.scripts)
                    .map((script) => script.src)
                    .find((src) => /\/qwen-chat-fe\/[^/]+\/js\/main\.js(?:$|\?)/.test(src));
                  const clientVersion = clientScript?.match(/\/qwen-chat-fe\/([^/]+)\//)?.[1];
                  if (clientVersion) headers.version = clientVersion;
                  if (isCompletionRequest) headers["x-accel-buffering"] = "no";
                  try {
                    const token = localStorage.getItem("token") || authToken || "";
                    if (token) headers.Authorization = `Bearer ${token}`;
                  } catch {}
                  let headersTimer;
                  const res = await Promise.race([
                    fetch(fetchUrl, {
                      method: "POST",
                      headers,
                      body,
                      credentials: "include",
                      signal: controller.signal,
                    }),
                    new Promise((_, reject) => {
                      headersTimer = setTimeout(() => {
                        reject(new Error("qwen_response_headers_timeout"));
                        controller.abort("qwen_response_headers_timeout");
                      }, responseHeadersTimeoutMs);
                    }),
                  ]).finally(() => clearTimeout(headersTimer));
                  const { text, contentType } = await readTextBody(res);
                  return {
                    ok: res.ok,
                    status: res.status,
                    retryAfter: res.headers.get("retry-after"),
                    contentType,
                    text,
                  };
                } catch (e) {
                  return {
                    ok: false,
                    status: 0,
                    contentType: "",
                    text:
                      `__fetch_error__: ${e.name || "Error"}: ${e.message}\n` +
                      `page=${window.location.href}\n` +
                      `request=${fetchUrl}`,
                  };
                } finally {
                  clearTimeout(timeoutId);
                }
              },
              { url, body, fetchTimeoutMs, responseHeadersTimeoutMs, streamFirstContentTimeoutMs: firstContentTimeoutMs, streamIdleTimeoutMs: idleTimeoutMs, requestId, accept, isCompletionRequest, authToken, workerId: worker.label },
            ),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("qwen_page_evaluate_timeout")), fetchTimeoutMs + 5000),
            ),
            challengeWatch.promise,
            ]);
          } finally {
            challengeWatch.dispose();
          }
          if (result.status !== 0 || attempt === attempts - 1) break;
          if (sawRawChunk) {
            // Чанки уже шли: POST был принят сервером и генерация началась.
            // Re-POST создал бы sibling-ветку — отдаём обрыв наверх для
            // resume по response_id (клиент) вместо слепого повтора.
            if (debug) console.log(`[qwen-proxy:${worker.label}] stream died mid-response (chunks already received) — NOT re-POSTing, handing break to resume`);
            break;
          }
          if (debug) console.log(`[qwen-proxy:${worker.label}] stream fetch failed before HTTP response; reloading page and retrying`);
          await reloadWorker(worker);
        } catch (error) {
          lastError = error;
          // isCompletionRequest объявлен в try и здесь не виден — пере-тест URL.
          if (sawRawChunk && /\/api\/v2\/chat\/completions(?:$|\?)/.test(url)) {
            // Генерация уже шла — повторный POST запретен (sibling-ветки).
            if (debug) console.log(`[qwen-proxy:${worker.label}] stream failed mid-generation — NOT re-POSTing, handing break to resume`);
            throw error;
          }
          if (!isTransientBrowserError(error) || attempt === attempts - 1) throw error;
          if (debug) console.log(`[qwen-proxy:${worker.label}] transient browser error during stream; reloading: ${error.message}`);
          try {
            if (isClosedBrowserError(error)) await recreateWorkerPage(worker);
            else await reloadWorker(worker);
          } catch (recoverError) {
            proxyContexts.delete(accountId);
      await backgroundBrowserPool.pin(`qwen:${accountId}`, false);
            throw recoverError;
          }
        }
      }
    } finally {
      streamRouter.unbind(worker.label);
    }
    if (!result && lastError) throw lastError;
    if (result.status === 0) {
      const failure = latestFailureFor(url);
      if (failure) {
        result.text += `\nnetwork=${failure.errorText}\nnetworkMethod=${failure.method}`;
      }
    }
    // Baxia punish (антибот-капча). Пробуем решить слайдер локально;
    // если не вышло — остаёмся на кулдауне из request-pacing.
    if (/\/api\/v2\/chat\/completions(?:$|\?)/.test(url) && isQwenPunishResponse(result)) {
      worker.currentChatId = null;
      const solved = await trySolvePunishOnWorker(worker, "text");
      if (solved) {
        // Baxia сам реплеит запрос после setCookieSuccess — просто отдаём
        // результат как есть, клиент сделает новую попытку без кулдауна.
        console.warn(`[qwen-proxy:${worker.label}] Baxia slider solved (stream path) — cooldown cleared`);
      } else {
        const { backoffMs } = startQwenPunishCooldown(Date.now(), accountId);
        result = { ...result, ok: false, punish: true };
        console.warn(`[qwen-proxy:${worker.label}] Baxia punish detected (stream) — cooldown ${Math.round(backoffMs / 1000)}s`);
      }
    }
    return result;
  }

  return {
    pendingCompletionRequests() { return completionTracker.pending(); },
    async submitNativeTurn({ chatId, prompt, images = [], parentId, model, thinking, search, allowNativeRootChat, signal, onRawChunk, beforeSend }) {
      const worker = pickWorker(chatId);
      return enqueue(worker, async () => {
        signal?.throwIfAborted();
        // Reload the saved chat so the SPA's branch reflects upstream history.
        await ensureChatPage(worker, allowNativeRootChat && parentId == null ? null : chatId, { force: true });
        await ensureQwenNativeSession(worker.page, { signal });
        signal?.throwIfAborted();
        const turnId = randomUUID();
        const workerId = `${worker.label}:native:${turnId}`;
        const nativeTurn = { chatId, parentId, allowNativeRootChat, bootstrap: null };
        nativeTurns.set(workerId, nativeTurn);
        const controller = new AbortController();
        const linkedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        const challenge = watchQwenPunishNavigation(worker.page, {
          isActive: () => worker.page.evaluate(id => {
            const state = window.__synvoxQwenNativeCapture;
            if (state?.turnId !== id || state.started !== true) return false;
            state.challengeSeen = true;
            return true;
          }, turnId),
        });
        streamRouter.bind(workerId, onRawChunk);
        try {
          const result = await runQwenNativeTurnWithChallenge({
            submit: () => submitQwenNativeTurn(worker.page, { workerId, turnId, chatId, prompt, images, parentId, model, thinking, search, allowNativeRootChat },
              { beforeSend, signal: linkedSignal, timeoutMs: QWEN_FETCH_TIMEOUT_MS }),
            challenge: challenge.promise,
            solve: () => trySolvePunishOnWorker(worker, "native", linkedSignal),
            recover: async () => {
              const deadline = Date.now() + QWEN_FETCH_TIMEOUT_MS;
              while (Date.now() < deadline) {
                linkedSignal.throwIfAborted();
                try {
                  const saved = await harvestQwenCheckpoint({
                    chatId: nativeTurn.bootstrap?.chatId || chatId,
                    checkpoint: { prompt, parentMessageId: parentId, ...(images.length ? { imageCount: images.length,
                      expectedImageFileIds: await worker.page.evaluate(() => window.__synvoxQwenNativeCapture?.imageFileIds).catch(() => null) } : {}) },
                    // This worker owns the pending native operation; queuing a
                    // history read behind it would deadlock recovery.
                    fetcher: ({ chatId, limit }) => worker.page.evaluate(qwenApiGetInPage, {
                      path: `/api/v2/chats/${encodeURIComponent(chatId)}?direction=up&limit=${limit}`,
                      timeoutMs: 15_000,
                    }),
                  });
                  linkedSignal.throwIfAborted();
                  if (saved?.text) return { ok: true, status: 200, contentType: 'text/plain',
                    text: saved.text, recoveredNativeAnswer: saved };
                } catch (error) {
                  if (linkedSignal.aborted) linkedSignal.throwIfAborted();
                }
                await sleep(3000, undefined, { signal: linkedSignal });
              }
              return null;
            },
            signal: linkedSignal,
          });
          return nativeTurn.bootstrap ? { ...result, nativeBootstrap: nativeTurn.bootstrap } : result;
        } catch (error) {
          if (nativeTurn.bootstrap) error.qwenNativeBootstrap = nativeTurn.bootstrap;
          throw error;
        } finally {
          nativeTurns.delete(workerId);
          controller.abort();
          challenge.dispose();
          streamRouter.unbind(workerId);
        }
      });
    },
    async saveCurrentAuth() {
      const { waitForQwenToken } = await import('./browser-login.mjs');
      const { writeQwenAuth, qwenCookieHeaderFromArray } = await import('./auth-files.mjs');
      const captured = await waitForQwenToken(context, { page: workers[0].page, timeoutMs: 2000, intervalMs: 100 });
      captured.cookieHeader = qwenCookieHeaderFromArray(captured.cookies);
      if (accountId === 'default') {
        writeQwenAuth(QWEN_AUTH_FILE, { ...captured, profileDir });
      } else {
        const { loadAccounts, saveAccounts } = await import('./account-store.mjs');
        const { isSameQwenIdentity } = await import('./account-manager.mjs');
        const accounts = loadAccounts();
        const account = accounts.find(item => item.id === accountId);
        if (!account || !isSameQwenIdentity(account, captured)) throw new Error('Qwen: в браузере открыт другой аккаунт.');
        Object.assign(account, captured, { invalid: false });
        saveAccounts(accounts);
        writeQwenAuth(pathMod.join(profileDir, 'auth.json'), { ...captured, profileDir });
      }
      await session.persistStorageState();
      return captured;
    },
    captchaPage() { return workers[0].page; },
    async showCaptchaWindow() {
      const page = workers[0].page;
      await page.bringToFront();
      let challengeVisible = await page.evaluate(isQwenChallengeVisible).catch(() => false);
      if (!challengeVisible) {
        challengeVisible = await page.waitForFunction(isQwenChallengeVisible, undefined, { timeout: 1200 })
          .then(() => true).catch(() => false);
      }
      const loginRequired = !challengeVisible && await page.evaluate(qwenPageNeedsLogin).catch(() => false);
      return { challengeVisible, loginRequired };
    },
    async hasCaptchaClearance() {
      const cookieHeader = await workers[0].page.evaluate(() => document.cookie).catch(() => "");
      return hasQwenClearanceCookieHeader(cookieHeader);
    },
    // Прокинуть fetch через контекст страницы. Перед запросом обязательно
    // переходим на /c/<chatId>, чтобы чат был зарегистрирован SPA-роутером.
    // Возвращает { ok, status, contentType, text } — Node парсит text сам.
    async proxyFetch({ url, body, chatId, timeoutMs, streamIdleTimeoutMs, maxAttempts, beforeSend }) {
      const worker = pickWorker(chatId);
      return enqueue(worker, () => runProxyFetch(worker, {
        url,
        body,
        chatId,
        timeoutMs,
        streamIdleTimeoutMs,
        maxAttempts,
        beforeSend,
      }));
    },
    async proxyFetchStream({ url, body, chatId, onRawChunk, timeoutMs, streamFirstContentTimeoutMs, streamIdleTimeoutMs, maxAttempts, beforeSend }) {
      const worker = pickWorker(chatId);
      return enqueue(worker, () => runProxyFetchStream(worker, {
        url,
        body,
        chatId,
        onRawChunk,
        timeoutMs,
        streamFirstContentTimeoutMs,
        streamIdleTimeoutMs,
        maxAttempts,
        beforeSend,
      }));
    },
    // Same-origin POST к API chat.qwen.ai из контекста страницы — для файловых
    // эндпоинтов (getstsToken / parse / parse/status). bx-ua подписывается
    // JS-бандлом страницы автоматически, как у настоящего веб-интерфейса.
    // ВАЖНО: page.evaluate сериализует результат (JSON) — функции не переносятся,
    // поэтому json возвращаем как plain-поле, а не метод.
    async proxyApiPost({ path, body, chatId, timeoutMs = 30_000 }) {
      const worker = pickWorker(chatId || null);
      return enqueue(worker, () => worker.page.evaluate(
        async ({ path, body, timeoutMs }) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort("qwen_fetch_timeout"), timeoutMs);
          try {
            const res = await fetch(path, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                accept: "application/json, text/plain, */*",
                source: "web",
              },
              credentials: "include",
              body: JSON.stringify(body),
              signal: controller.signal,
            });
            const json = await res.json().catch(() => null);
            return { ok: res.ok, status: res.status, json };
          } finally {
            clearTimeout(timeoutId);
          }
        },
        { path, body, timeoutMs },
      ));
    },
    // Same-origin GET к API chat.qwen.ai из контекста страницы — для чтения
    // истории чата (harvest сохранённого ответа после обрыва стрима).
    async proxyApiGet({ path, chatId, timeoutMs = 30_000 }) {
      const worker = pickWorker(chatId || null);
      return enqueue(worker, () => worker.page.evaluate(
        qwenApiGetInPage,
        { path, timeoutMs, authToken },
      ));
    },
    async close() { await close(); },
  };
  } catch (error) {
    await session.close().catch(() => {});
    throw error;
  }
}
