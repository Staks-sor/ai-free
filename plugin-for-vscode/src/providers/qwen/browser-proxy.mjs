// Невидимый Playwright-прокси для Qwen API.
//
// ЗАЧЕМ:
// Заголовок `bx-ua` — это криптоподпись запроса, генерируемая JS+WASM-бандлом
// chat.qwen.ai. Она привязана к URL + хешу body + nonce + bx-umidtoken.
// Поэтому скопировать `bx-ua` из cURL в .env и переиспользовать — не работает,
// сервер всегда отвечает `Bad_Request`.
//
// РЕШЕНИЕ:
// Держим один persistent Chromium с открытой страницей chat.qwen.ai.
// Все наши POST идут через `page.evaluate(fetch)` — браузер выполняет fetch
// в контексте страницы, их перехватчик автоматически подписывает запрос
// свежим `bx-ua` и кладёт куки/origin/referer.
//
// Для нас это прозрачный прокси — мы передаём url+body, получаем text ответа.
//
// Lifecycle: ленивый launch на первом вызове, держим контекст до закрытия процесса.

import { QWEN_AUTH_FILE, QWEN_BASE_URL, QWEN_BROWSER_PROFILE } from "./config.mjs";
import { applyQwenCookiesToContext, readQwenAuth } from "./auth-files.mjs";
import { randomUUID } from "node:crypto";
import { resolveQwenStreamTimeouts } from "./stream-timeouts.mjs";
import { isQwenPunishResponse, startQwenPunishCooldown, clearQwenPunishCooldown } from "./request-pacing.mjs";
import { resolveBaxiaSolverConfig, trySolveBaxiaOnPage } from "./baxia-solver.mjs";

const proxyContexts = new Map(); // accountId -> { promise }
const QWEN_NAV_TIMEOUT_MS = Number(process.env.QWEN_NAV_TIMEOUT_MS || 90_000);
const QWEN_READY_DELAY_MS = Number(process.env.QWEN_READY_DELAY_MS || 3000);
const QWEN_READY_POLL_MS = Number(process.env.QWEN_READY_POLL_MS || 100);
const QWEN_STREAM_TIMEOUTS = resolveQwenStreamTimeouts();
const QWEN_FETCH_TIMEOUT_MS = QWEN_STREAM_TIMEOUTS.fetchMs;
const QWEN_STREAM_FIRST_CONTENT_TIMEOUT_MS = QWEN_STREAM_TIMEOUTS.firstContentMs;
const QWEN_STREAM_IDLE_TIMEOUT_MS = QWEN_STREAM_TIMEOUTS.idleMs;
const QWEN_PROXY_MAX_ATTEMPTS = Math.max(1, Math.min(5, Number(process.env.QWEN_PROXY_MAX_ATTEMPTS || 3)));
const QWEN_BROWSER_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.QWEN_BROWSER_CONCURRENCY || 1)));

function isTransientBrowserError(error) {
  const message = String(error?.message || error || "");
  return /Execution context was destroyed|most likely because of a navigation|Target closed|Page closed|Context closed|Timeout .* exceeded|qwen_page_evaluate_timeout|net::ERR_ABORTED|Failed to fetch|request is finished/i.test(message);
}

function isClosedBrowserError(error) {
  const message = String(error?.message || error || "");
  return /Target closed|Page closed|Context closed|Browser has been closed/i.test(message);
}

function hashChatId(chatId) {
  let hash = 0;
  for (const ch of String(chatId || "")) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

// Сброс singleton после re-login / refresh — следующий запрос поднимет прокси с новыми куками.
export async function closeQwenBrowserProxy(accountId = null) {
  if (accountId) {
    const entry = proxyContexts.get(accountId);
    if (entry) {
      proxyContexts.delete(accountId);
      try { const proxy = await entry.promise; await proxy.close?.(); } catch {}
    }
    return;
  }
  for (const [id, entry] of proxyContexts.entries()) {
    try { const proxy = await entry.promise; await proxy.close?.(); } catch {}
  }
  proxyContexts.clear();
}

export function resetQwenBrowserProxy(accountId = null) {
  return closeQwenBrowserProxy(accountId);
}

// Возвращает singleton-инстанс прокси. Все вызовы делят один Chromium.
export function getQwenBrowserProxy({ accountId = 'default', debug = false } = {}) {
  if (!proxyContexts.has(accountId)) {
    const p = createProxy({ accountId, debug }).catch((err) => {
      proxyContexts.delete(accountId);
      throw err;
    });
    proxyContexts.set(accountId, { promise: p });
  }
  return proxyContexts.get(accountId).promise;
}

async function createProxy({ accountId, debug }) {
  const { ensureBrowserBinaries } = await import("../../browser/ensure-binaries.mjs");
  const browserReady = await ensureBrowserBinaries();
  if (!browserReady.ok) {
    throw new Error(browserReady.error || "Chromium browser binaries are not installed.");
  }
  const { getChatGPTChromium } = await import("../chatgpt/engine.mjs");
  const chromium = await getChatGPTChromium();

  if (debug) console.log("[qwen-proxy] launching headless Chromium with profile…");

  const pathMod = await import('node:path');
  const baseProfile = QWEN_BROWSER_PROFILE;
  let profileDir = accountId === 'default' ? baseProfile : pathMod.resolve(baseProfile, '..', `qwen-profile-${accountId}`);
  if (accountId !== 'default') {
    try {
      const { getAccountById } = await import('./account-store.mjs');
      const account = getAccountById(accountId);
      if (account?.profileDir) profileDir = account.profileDir;
    } catch {}
  }
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    locale: "ru-RU",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=site-per-process",
    ],
  });

  // Стелс — те же меры, что в browser-login.mjs.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", {
      get: () => [
        { name: "PDF Viewer", filename: "internal-pdf-viewer", description: "" },
        { name: "Chrome PDF Viewer", filename: "internal-pdf-viewer", description: "" },
      ],
    });
    Object.defineProperty(navigator, "languages", { get: () => ["ru-RU", "ru", "en"] });
    if (!window.chrome) window.chrome = { runtime: {} };
  });

  const firstPage = context.pages()[0] || (await context.newPage());
  const recentRequestFailures = [];

  function attachPageDiagnostics(page, label) {
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
  const trySolvePunishOnWorker = async (worker, pathLabel) => {
    const cfg = resolveBaxiaSolverConfig();
    if (!cfg.enabled) return false;
    try {
      const res = await trySolveBaxiaOnPage(worker.page, cfg, {
        log: (msg) => console.warn(`[qwen-proxy:${worker.label}] baxia-solver(${pathLabel}): ${msg}`),
      });
      if (res.solved) {
        clearQwenPunishCooldown();
        return true;
      }
      console.warn(`[qwen-proxy:${worker.label}] baxia-solver(${pathLabel}): not solved (${res.error} after ${res.tries} tries) — fallback to cooldown`);
      return false;
    } catch (err) {
      console.warn(`[qwen-proxy:${worker.label}] baxia-solver(${pathLabel}) failed: ${err?.message || err}`);
      return false;
    }
  };

  let rawStreamHandler = null;
  await context.exposeFunction("__qwenRawStreamChunk", async (chunk) => {
    return typeof rawStreamHandler === "function" && rawStreamHandler(chunk) === true;
  });

  // auth.json может быть свежее профиля (import-qwen, silent refresh). Подмешиваем куки до goto.
  let authToken = "";
  let cookiesToInject = [];
  if (accountId !== 'default') {
    const { getAccountById } = await import("./account-store.mjs");
    const account = getAccountById(accountId);
    authToken = account?.token || "";
    cookiesToInject = account?.cookies || [];
  } else {
    const savedAuth = readQwenAuth(QWEN_AUTH_FILE);
    authToken = savedAuth?.token || "";
    cookiesToInject = savedAuth?.cookies || [];
  }
  if (cookiesToInject.length) {
    const n = await applyQwenCookiesToContext(context, cookiesToInject);
    if (debug) console.log(`[qwen-proxy:${accountId}] injected ${n} cookies`);
  }

  async function primeQwenPageAuth(page) {
    if (!authToken) return;
    await page.evaluate((token) => {
      try { localStorage.setItem("token", token); } catch {}
    }, authToken);
  }

  async function waitForQwenRuntime(page) {
    await page.waitForFunction(() => {
      if (document.readyState === "loading") return false;
      return Array.from(document.scripts).some((script) =>
        /\/qwen-chat-fe\/[^/]+\/js\/main\.js(?:$|\?)/.test(script.src || ""),
      );
    }, null, {
      timeout: QWEN_READY_DELAY_MS,
      polling: Math.max(50, QWEN_READY_POLL_MS),
    }).catch(() => {});
  }

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
    await worker.page.goto(QWEN_BASE_URL, { waitUntil: "domcontentloaded", timeout: QWEN_NAV_TIMEOUT_MS });
    await primeQwenPageAuth(worker.page);
    // Даём JS-бандлу проинициализировать перехватчик fetch / bx-ua (на слабых сетях 1-2 сек мало).
    await waitForQwenRuntime(worker.page);
  }));

  if (debug) console.log(`[qwen-proxy] ready (${workers.length} page${workers.length === 1 ? "" : "s"})`);

  let nextWorkerIndex = 0;

  // Graceful shutdown при завершении процесса.
  const close = async () => {
    try {
      await Promise.all(workers.map((worker) => worker.queue.catch(() => {})));
      await context.close();
    } catch {}
  };
  process.once("exit", () => { close(); });

  // Навигация на /c/<chatId>. Это, похоже, ЕДИНСТВЕННЫЙ способ зарегистрировать
  // chat_id на сервере Qwen — после goto JS-бандл сам делает скрытую синхронизацию
  // (WebSocket / late POST), и сервер начинает принимать /completions для этого id.
  async function ensureChatPage(worker, chatId) {
    if (worker.currentChatId === chatId) return;
    if (debug) console.log(`[qwen-proxy:${worker.label}] navigating to /c/${chatId}`);
    await worker.page.goto(`${QWEN_BASE_URL}/c/${encodeURIComponent(chatId)}`, {
      waitUntil: "domcontentloaded",
      timeout: QWEN_NAV_TIMEOUT_MS,
    });
    await primeQwenPageAuth(worker.page);
    // Подождём, пока SPA доделает свою регистрацию и поднимет антибот-перехватчики.
    await waitForQwenRuntime(worker.page);
    worker.currentChatId = chatId;
  }

  async function ensureNewChatPage(worker) {
    if (worker.currentChatId === "new-chat") return;
    if (debug) console.log(`[qwen-proxy:${worker.label}] navigating to /c/new-chat`);
    await worker.page.goto(`${QWEN_BASE_URL}/c/new-chat`, {
      waitUntil: "domcontentloaded",
      timeout: QWEN_NAV_TIMEOUT_MS,
    });
    await primeQwenPageAuth(worker.page);
    await waitForQwenRuntime(worker.page);
    worker.currentChatId = "new-chat";
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
    await worker.page.goto(QWEN_BASE_URL, { waitUntil: "domcontentloaded", timeout: QWEN_NAV_TIMEOUT_MS });
    await primeQwenPageAuth(worker.page);
    await waitForQwenRuntime(worker.page);
  }

  async function runProxyFetch(worker, { url, body, chatId, timeoutMs, streamIdleTimeoutMs, maxAttempts }) {
    let result = null;
    let lastError = null;
    const fetchTimeoutMs = Number(timeoutMs || QWEN_FETCH_TIMEOUT_MS);
    const idleTimeoutMs = Number(streamIdleTimeoutMs || QWEN_STREAM_IDLE_TIMEOUT_MS);
    const attempts = Math.max(1, Math.min(5, Number(maxAttempts || QWEN_PROXY_MAX_ATTEMPTS)));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        if (chatId) await ensureChatPage(worker, chatId);
        else if (/\/api\/v2\/chats\/new(?:$|\?)/.test(url)) await ensureNewChatPage(worker);
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
                  "bx-v": "2.5.36",
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
                const umidMatch = document.cookie.match(/(?:^|;\\s*)lswusea=([^;]+)/);
                if (umidMatch) {
                  const raw = decodeURIComponent(umidMatch[1]);
                  const at = raw.indexOf("@@");
                  headers["bx-umidtoken"] = at >= 0 ? raw.slice(0, at) : raw;
                }
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
        const { backoffMs } = startQwenPunishCooldown();
        result = { ...result, ok: false, punish: true };
        console.warn(`[qwen-proxy:${worker.label}] Baxia punish detected — cooldown ${Math.round(backoffMs / 1000)}s (see browser window to solve captcha)`);
      }
    }
    return result;
  }

  async function runProxyFetchStream(worker, { url, body, chatId, onRawChunk, timeoutMs, streamFirstContentTimeoutMs, streamIdleTimeoutMs, maxAttempts }) {
    let result = null;
    let lastError = null;
    const fetchTimeoutMs = Number(timeoutMs || QWEN_FETCH_TIMEOUT_MS);
    const firstContentTimeoutMs = Number(streamFirstContentTimeoutMs || QWEN_STREAM_FIRST_CONTENT_TIMEOUT_MS);
    const idleTimeoutMs = Number(streamIdleTimeoutMs || QWEN_STREAM_IDLE_TIMEOUT_MS);
    const attempts = Math.max(1, Math.min(5, Number(maxAttempts || QWEN_PROXY_MAX_ATTEMPTS)));
    // Признак того, что сервер уже начал отдавать SSE-чанки. Если после этого
    // fetch умер (status 0 / abort), повторный POST того же body создал бы
    // sibling-ветку в дереве сообщений и дублировал текст — вместо этого
    // обрыв уходит наверх, и клиент восстанавливает стрим по response_id.
    let sawRawChunk = false;
    rawStreamHandler = typeof onRawChunk === "function"
      ? (chunk) => {
        sawRawChunk = true;
        return onRawChunk(chunk);
      }
      : null;
    try {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          if (chatId) await ensureChatPage(worker, chatId);
          else if (/\/api\/v2\/chats\/new(?:$|\?)/.test(url)) await ensureNewChatPage(worker);
          const requestId = randomUUID();
          const isCompletionRequest = /\/api\/v2\/chat\/completions(?:$|\?)/.test(url);
          const accept = isCompletionRequest
            ? "application/json"
            : "application/json, text/plain, */*";
          sawRawChunk = false;
          result = await Promise.race([
            worker.page.evaluate(
              async ({ url, body, fetchTimeoutMs, streamFirstContentTimeoutMs, streamIdleTimeoutMs, requestId, accept, isCompletionRequest, authToken }) => {
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
                    if (text) await window.__qwenRawStreamChunk(text);
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
                      if (piece && await window.__qwenRawStreamChunk(piece)) hasMeaningfulContent = true;
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
                      if (await window.__qwenRawStreamChunk(tail)) hasMeaningfulContent = true;
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
                    "bx-v": "2.5.36",
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
                  const umidMatch = document.cookie.match(/(?:^|;\\s*)lswusea=([^;]+)/);
                  if (umidMatch) {
                    const raw = decodeURIComponent(umidMatch[1]);
                    const at = raw.indexOf("@@");
                    headers["bx-umidtoken"] = at >= 0 ? raw.slice(0, at) : raw;
                  }
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
              { url, body, fetchTimeoutMs, streamFirstContentTimeoutMs: firstContentTimeoutMs, streamIdleTimeoutMs: idleTimeoutMs, requestId, accept, isCompletionRequest, authToken },
            ),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("qwen_page_evaluate_timeout")), fetchTimeoutMs + 5000),
            ),
          ]);
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
            throw recoverError;
          }
        }
      }
    } finally {
      rawStreamHandler = null;
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
      const solved = await trySolvePunishOnWorker(worker, "text");
      if (solved) {
        // Baxia сам реплеит запрос после setCookieSuccess — просто отдаём
        // результат как есть, клиент сделает новую попытку без кулдауна.
        console.warn(`[qwen-proxy:${worker.label}] Baxia slider solved (stream path) — cooldown cleared`);
      } else {
        const { backoffMs } = startQwenPunishCooldown();
        result = { ...result, ok: false, punish: true };
        console.warn(`[qwen-proxy:${worker.label}] Baxia punish detected (stream) — cooldown ${Math.round(backoffMs / 1000)}s`);
      }
    }
    return result;
  }

  return {
    // Прокинуть fetch через контекст страницы. Перед запросом обязательно
    // переходим на /c/<chatId>, чтобы чат был зарегистрирован SPA-роутером.
    // Возвращает { ok, status, contentType, text } — Node парсит text сам.
    async proxyFetch({ url, body, chatId, timeoutMs, streamIdleTimeoutMs, maxAttempts }) {
      const worker = pickWorker(chatId);
      return enqueue(worker, () => runProxyFetch(worker, {
        url,
        body,
        chatId,
        timeoutMs,
        streamIdleTimeoutMs,
        maxAttempts,
      }));
    },
    async proxyFetchStream({ url, body, chatId, onRawChunk, timeoutMs, streamFirstContentTimeoutMs, streamIdleTimeoutMs, maxAttempts }) {
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
        async ({ path, timeoutMs }) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort("qwen_fetch_timeout"), timeoutMs);
          try {
            const res = await fetch(path, {
              method: "GET",
              headers: {
                accept: "application/json, text/plain, */*",
                source: "web",
              },
              credentials: "include",
              signal: controller.signal,
            });
            const json = await res.json().catch(() => null);
            return { ok: res.ok, status: res.status, json };
          } finally {
            clearTimeout(timeoutId);
          }
        },
        { path, timeoutMs },
      ));
    },
    async close() { await close(); },
  };
}
