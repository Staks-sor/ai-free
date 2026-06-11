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
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";

let proxyPromise = null;
const QWEN_NAV_TIMEOUT_MS = Number(process.env.QWEN_NAV_TIMEOUT_MS || 90_000);
const QWEN_READY_DELAY_MS = Number(process.env.QWEN_READY_DELAY_MS || 3000);
const QWEN_FETCH_TIMEOUT_MS = Number(process.env.QWEN_FETCH_TIMEOUT_MS || 120_000);
const QWEN_STREAM_IDLE_TIMEOUT_MS = Number(process.env.QWEN_STREAM_IDLE_TIMEOUT_MS || 45_000);
const QWEN_PROXY_MAX_ATTEMPTS = Math.max(1, Math.min(5, Number(process.env.QWEN_PROXY_MAX_ATTEMPTS || 3)));
const QWEN_BROWSER_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.QWEN_BROWSER_CONCURRENCY || 1)));
const here = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../../..");

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

// Сброс singleton после re-login / refresh — следующий запрос поднимет прокси с новыми куками.
export function resetQwenBrowserProxy() {
  if (proxyPromise) {
    proxyPromise
      .then((proxy) => proxy.close?.())
      .catch(() => {});
  }
  proxyPromise = null;
}

// Возвращает singleton-инстанс прокси. Все вызовы делят один Chromium.
export function getQwenBrowserProxy({ debug = false } = {}) {
  if (!proxyPromise) {
    proxyPromise = createProxy({ debug }).catch((err) => {
      // При сбое сбрасываем, чтобы следующий вызов попробовал заново.
      proxyPromise = null;
      throw err;
    });
  }
  return proxyPromise;
}

async function createProxy({ debug }) {
  const { chromium } = await import("playwright");

  if (debug) console.log("[qwen-proxy] launching headless Chromium with profile…");

  const launchOptions = {
    headless: true,
    viewport: { width: 1280, height: 800 },
    locale: "ru-RU",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=site-per-process",
    ],
  };
  let context;
  try {
    context = await chromium.launchPersistentContext(QWEN_BROWSER_PROFILE, launchOptions);
  } catch (error) {
    if (shouldInstallPlaywrightBrowser(error) && installPlaywrightChromium()) {
      context = await chromium.launchPersistentContext(QWEN_BROWSER_PROFILE, launchOptions);
    } else {
      throw error;
    }
  }

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

  // auth.json может быть свежее профиля (import-qwen, silent refresh). Подмешиваем куки до goto.
  const savedAuth = readQwenAuth(QWEN_AUTH_FILE);
  if (savedAuth?.cookies?.length) {
    const n = await applyQwenCookiesToContext(context, savedAuth.cookies);
    if (debug) console.log(`[qwen-proxy] injected ${n} cookies from auth.json`);
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
    // Даём JS-бандлу проинициализировать перехватчик fetch / bx-ua (на слабых сетях 1-2 сек мало).
    await worker.page.waitForTimeout(QWEN_READY_DELAY_MS);
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
  process.once("SIGINT", () => { close().then(() => process.exit(0)); });
  process.once("SIGTERM", () => { close().then(() => process.exit(0)); });

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
    // Подождём, пока SPA доделает свою регистрацию и поднимет антибот-перехватчики.
    await worker.page.waitForTimeout(QWEN_READY_DELAY_MS);
    worker.currentChatId = chatId;
  }

  async function ensureNewChatPage(worker) {
    if (worker.currentChatId === "new-chat") return;
    if (debug) console.log(`[qwen-proxy:${worker.label}] navigating to /c/new-chat`);
    await worker.page.goto(`${QWEN_BASE_URL}/c/new-chat`, {
      waitUntil: "domcontentloaded",
      timeout: QWEN_NAV_TIMEOUT_MS,
    });
    await worker.page.waitForTimeout(QWEN_READY_DELAY_MS);
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
    await worker.page.waitForTimeout(QWEN_READY_DELAY_MS);
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
          async ({ url, body, fetchTimeoutMs, streamIdleTimeoutMs, requestId, accept, isCompletionRequest }) => {
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
                version: "0.2.64",
                timezone: new Date().toString().replace(/\s*\(.+\)$/, ""),
                "x-request-id": requestId,
              };
              if (isCompletionRequest) headers["x-accel-buffering"] = "no";
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
          { url, body, fetchTimeoutMs, streamIdleTimeoutMs: idleTimeoutMs, requestId, accept, isCompletionRequest },
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
          proxyPromise = null;
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
    async close() { await close(); },
  };
}
