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

let proxyPromise = null;
const QWEN_NAV_TIMEOUT_MS = Number(process.env.QWEN_NAV_TIMEOUT_MS || 90_000);
const QWEN_READY_DELAY_MS = Number(process.env.QWEN_READY_DELAY_MS || 3000);
const QWEN_BROWSER_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.QWEN_BROWSER_CONCURRENCY || 1)));

function isTransientBrowserError(error) {
  const message = String(error?.message || error || "");
  return /Execution context was destroyed|most likely because of a navigation|Target closed|Page closed|Context closed|Timeout .* exceeded|net::ERR_ABORTED|Failed to fetch|request is finished/i.test(message);
}

function hashChatId(chatId) {
  let hash = 0;
  for (const ch of String(chatId || "")) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return Math.abs(hash);
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

  const context = await chromium.launchPersistentContext(QWEN_BROWSER_PROFILE, {
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

  async function reloadWorker(worker) {
    worker.currentChatId = null;
    await worker.page.goto(QWEN_BASE_URL, { waitUntil: "domcontentloaded", timeout: QWEN_NAV_TIMEOUT_MS });
    await worker.page.waitForTimeout(QWEN_READY_DELAY_MS);
  }

  async function runProxyFetch(worker, { url, body, chatId }) {
    let result = null;
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (chatId) await ensureChatPage(worker, chatId);
        result = await worker.page.evaluate(
          async ({ url, body }) => {
            const requestUrl = new URL(url);
            const sameOrigin = requestUrl.origin === window.location.origin;
            const fetchUrl = sameOrigin ? `${requestUrl.pathname}${requestUrl.search}` : url;
            try {
              const res = await fetch(fetchUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body,
                credentials: "include",
              });
              const text = await res.text();
              return {
                ok: res.ok,
                status: res.status,
                contentType: res.headers.get("content-type") || "",
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
            }
          },
          { url, body },
        );
        if (result.status !== 0 || attempt === 2) break;
        if (debug) console.log(`[qwen-proxy:${worker.label}] fetch failed before HTTP response; reloading page and retrying`);
        await reloadWorker(worker);
      } catch (error) {
        lastError = error;
        if (!isTransientBrowserError(error) || attempt === 2) throw error;
        if (debug) console.log(`[qwen-proxy:${worker.label}] transient browser error; reloading page and retrying: ${error.message}`);
        await reloadWorker(worker);
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
    async proxyFetch({ url, body, chatId }) {
      const worker = pickWorker(chatId);
      return enqueue(worker, () => runProxyFetch(worker, { url, body, chatId }));
    },
    async close() { await close(); },
  };
}
