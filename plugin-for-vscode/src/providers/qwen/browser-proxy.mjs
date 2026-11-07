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
import { isQwenPunishResponse, startQwenPunishCooldown, clearQwenPunishCooldown, createQwenPunishError, qwenAntibotCooldownRemainingMs } from "./request-pacing.mjs";
import { resolveBaxiaSolverConfig, trySolveBaxiaOnPage, isBaxiaPunishUrl, isBaxiaNavigationError, isBaxiaGuardedUrl } from "./baxia-solver.mjs";
import { shouldRecordTelemetry, createTelemetryRecorder } from "./telemetry-recorder.mjs";

const proxyContexts = new Map(); // accountId -> { promise }
const QWEN_NAV_TIMEOUT_MS = Number(process.env.QWEN_NAV_TIMEOUT_MS || 90_000);
// Окно браузера Qwen: headless по умолчанию, но QWEN_BROWSER_HEADLESS=0
// показывает окно — там Baxia-слайдер проходят скорее (риск-скоринг видит
// реальный рендер), и капчу можно решить вручную, если автосолвер не смог.
const QWEN_BROWSER_HEADLESS = !/^(0|false|no|off)$/i.test(String(process.env.QWEN_BROWSER_HEADLESS ?? "1"));
const QWEN_READY_DELAY_MS = Number(process.env.QWEN_READY_DELAY_MS || 3000);
const QWEN_READY_POLL_MS = Number(process.env.QWEN_READY_POLL_MS || 100);
const QWEN_STREAM_TIMEOUTS = resolveQwenStreamTimeouts();
const QWEN_FETCH_TIMEOUT_MS = QWEN_STREAM_TIMEOUTS.fetchMs;
const QWEN_STREAM_FIRST_CONTENT_TIMEOUT_MS = QWEN_STREAM_TIMEOUTS.firstContentMs;
const QWEN_STREAM_IDLE_TIMEOUT_MS = QWEN_STREAM_TIMEOUTS.idleMs;
const QWEN_PROXY_MAX_ATTEMPTS = Math.max(1, Math.min(5, Number(process.env.QWEN_PROXY_MAX_ATTEMPTS || 3)));
// Инцидент 03.10 «субагенты через ai-free не работают»: при 1 живом аккаунте
// главный стрим + 4 субагента (stream:false) сериализовались в одну страницу
// (ttft главного до 426с, субагенты стояли минутами). Дефолт поднят с 1 до 2:
// страницы того же persistent-контекста — это НЕ второй Chromium на профиле
// (убийца cookie-баз 29.09 был отдельным launchPersistentContext).
export function resolveQwenBrowserConcurrency(env = process.env) {
  const raw = Number(env.QWEN_BROWSER_CONCURRENCY ?? 2);
  if (!Number.isFinite(raw)) return 2;
  return Math.max(1, Math.min(4, Math.floor(raw)));
}
const QWEN_BROWSER_CONCURRENCY = resolveQwenBrowserConcurrency();

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

// План ретрая warm-up навигации. Сетевые гонки (TLS-handshake завис,
// DNS-глюк) лечатся повтором с паузой; 3 неудачи подряд или не-сетевые
// ошибки — честная сдача (инцидент 2026-09-29: ERR_TIMED_OUT убивал
// warm-up молча, окно не открывалось, юзер не понимал почему).
const QWEN_WARMUP_RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
const QWEN_WARMUP_NET_ERROR_RE = /net::ERR_(TIMED_OUT|NAME_NOT_RESOLVED|CONNECTION_REFUSED|CONNECTION_RESET|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED)|ERR_CONNECTION_TIMED_OUT|ERR_PROXY_CONNECTION_FAILED/i;

export function qwenWarmupRetryPlan({ attempt, error } = {}) {
  const msg = String(error?.message || "");
  if (!QWEN_WARMUP_NET_ERROR_RE.test(msg)) return { action: "giveup", delayMs: 0 };
  // attempt — индекс ошибки (0-based): 3 сетевых провала подряд = сдача
  if (attempt >= QWEN_WARMUP_RETRY_DELAYS_MS.length) return { action: "giveup", delayMs: 0 };
  return { action: "retry", delayMs: QWEN_WARMUP_RETRY_DELAYS_MS[attempt] };
}

// 2026-09-29: access-JWT живёт ~17-20 минут, SPA обновляет его только при
// загрузке страницы. 401-in-200 (unauthorized в теле успешного статуса) —
// сигнал перезагрузить воркер: SPA сам сделает auth.qwen.ai/api/v2/auths/refresh
// и положит свежий JWT в localStorage. Punish-HTML сюда НЕ попадает (антибот).
// Синкать ли куки вместе с живым минтом (health/refresh): свежий токен +
// протухшие куки = бомба (инжект при живом токене роняет сессию).
export function shouldSyncCookieSnapshot({ tokenAlive } = {}) {
  return Boolean(tokenAlive);
}

// Единая точка для ВСЕХ слот-апдейтов: снапшот с живым токеном → атомарно
// {token, cookies} (полусвежий слот = бомба: живой токен + старые куки,
// инжект при живом токене убивает сессию — инцидент 02.10 14:51).
// Без снапшота — только токен (куки в слоте не трогаем).
export function slotSyncPayload({ snapshot, token } = {}) {
  if (shouldSyncCookieSnapshot({ tokenAlive: Boolean(snapshot?.token) }) && Array.isArray(snapshot?.cookies) && snapshot.cookies.length > 0) {
    return { token, cookies: snapshot.cookies };
  }
  return { token };
}

// Инжектить ли кукиснапшот из accounts.json/auth.json при загрузке воркера.
// Контракт 2026-10-02: ТОЛЬКО при живом сохранённом токене. Протухший снапшот
// поверх живого профиля убивает сессию серверно (SPA бутится logged-out,
// чистит localStorage, минта нет) — так health-check валил живые аккаунты.
export function shouldInjectQwenCookies({ tokenExp, nowSec } = {}) {
  return Boolean(tokenExp && tokenExp > nowSec);
}

// Праймить ли localStorage сохранённым токеном при загрузке воркера.
// Контракт 2026-10-02: ТОЛЬКО живой токен (exp в будущем). Протухший authToken
// из accounts.json, записанный в qwen_access_token_state, глушит SPA-минт
// (SPA видит «токен есть» и не делает auth-bootstrap) — waitForLiveToken
// вечно ждёт, health валил живые аккаунты. До cookie_gate v2 приминг писал
// мёртвый старый ключ, SPA его не читал — работало вхолостую.
export function shouldPrimeQwenAuth({ tokenExp, nowSec } = {}) {
  return Boolean(tokenExp && tokenExp > nowSec);
}

// Разрешён ли ещё reload в ЭТОМ вызове. Инвариант «один reload на вызов»:
// рекурсивный ретрай после reload получает НОВЫЙ кадр стека, где локальный
// alreadyAuthReloaded=false — без проброса флага любой невосстановимый 401
// превращается в бесконечный цикл reload→retry→401 (2026-09-30: 33 подряд).
export function shouldAllowAuthReload({ alreadyAuthReloaded } = {}) {
  return !alreadyAuthReloaded;
}

// Решение после auth-reload: ретраить fetch можно только со СВЕЖИМ JWT.
// Инцидент 2026-09-30 «бесконечный reload»: SPA с мёртвым refresh_token не
// обновляет токен, ретрай со старым ловит 401 и рекурсивно зовёт reload —
// цикл по ~17с навсегда. Нет свежего токена → giveup (ошибка наверх,
// ротация аккаунта на уровне хендлера).
export function qwenAuthRetryAfterReload(freshToken) {
  if (!freshToken) return "giveup";
  const exp = qwenJwtExp(freshToken);
  if (!exp || exp <= Date.now() / 1000 + 30) return "giveup";
  return "retry";
}

export function qwenNeedsAuthReload(result) {
  if (!result) return false;
  // Инцидент 2026-09-30 «no id in response»-каскад: Qwen кладёт
  // {"code":"unauthorized"} В ТЕЛО HTTP 200 (result.ok=true) — детект по
  // result.ok пропускал его, самолечение не запускалось и ошибка летела
  // наверх как createChat-failure. Смотрим текст всегда, ok не отсекает.
  if (/"code"\s*:\s*"unauthorized"/i.test(String(result.text || ""))) return true;
  // Прямой HTTP 401 — тоже кандидат на SPA-refresh.
  if (result.status === 401) return true;
  return false;
}

// exp (секунды) из JWT-payload без верификации подписи. null при мусоре.
export function qwenJwtExp(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch { return null; }
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
      // getAccountAnyStatus (не getAccountById!): invalid-аккаунт тоже должен
      // проверяться/работать на своём живом профиле — иначе прокси грузит
      // несуществующий qwen-profile-<id> и SPA всегда logged-out
      // (смертельная петля health-check: сам валил, сам не мог проверить).
      const { getAccountAnyStatus } = await import('./account-store.mjs');
      const account = getAccountAnyStatus(accountId);
      if (account?.profileDir) profileDir = account.profileDir;
    } catch {}
  }
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: QWEN_BROWSER_HEADLESS,
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

  // Телеметрический жучок (QWEN_TELEMETRY=1): пишет полный сценарий сессии —
  // punish-навигации, ответы антибота, fourier-телеметрию, таймлайны драгов
  // и судьбу каждого POST — в telemetry/run-<ts>-<account>/events.jsonl.
  const telemetry = shouldRecordTelemetry()
    ? createTelemetryRecorder({ root: process.env.QWEN_TELEMETRY_DIR || "telemetry", label: accountId })
    : null;
  if (telemetry) {
    console.warn(`[qwen-proxy:${accountId}] telemetry ON -> ${telemetry.dir}`);
    telemetry.attachToContext(context, { capture: "full" });
    telemetry.attachToPage(firstPage, "page0", { capture: "full" });
  }
  const recentRequestFailures = [];

  function attachPageDiagnostics(page, label) {
    telemetry?.attachToPage(page, label, { capture: "full" });
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
   * Detect punish-navigation: Baxia (baxiaFetchHandler.js) может ПЕРЕНАПРАВИТЬ
   * страницу на /_____tmd_____/punish прямо во время page.evaluate(fetch) —
   * fetch падает с «Execution context was destroyed» ещё до тела ответа.
   * HAR 2026-09-24: это основной путь наказания прокси (12 циклов подряд).
   * Возвращает URL punish-страницы или null.
   */
  const punishNavigationUrl = async (page) => {
    try {
      const url = page.url();
      return isBaxiaPunishUrl(url) ? url : null;
    } catch {
      return null;
    }
  };

  /**
   * Обработать Baxia punish: попробовать автосолвер (страница УЖЕ на
   * punish-странице — слайдер в её iframe), при неудаче включить кулдаун.
   * Возвращает { punish: true } для результата fetch или null, если солвер
   * решил (Baxia сам реплеит исходный запрос после setCookieSuccess).
   */
  const handleBaxiaPunish = async (worker, pathLabel) => {
    const solveStarted = Date.now();
    const solved = await trySolvePunishOnWorker(worker, pathLabel);
    telemetry?.record("solver_result", { worker: worker.label, path: pathLabel, solved, ms: Date.now() - solveStarted });
    if (solved) {
      console.warn(`[qwen-proxy:${worker.label}] Baxia slider solved (${pathLabel} path) — cooldown cleared`);
      return null;
    }
    const { backoffMs } = startQwenPunishCooldown(Date.now(), accountId);
    console.warn(`[qwen-proxy:${worker.label}] Baxia punish detected (${pathLabel}) — cooldown ${Math.round(backoffMs / 1000)}s`);
    return {
      ok: false,
      status: 403,
      contentType: "text/html",
      text: `baxia_punish_navigation: ${await punishNavigationUrl(worker.page) || "unknown"}`,
      punish: true,
    };
  };

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
        telemetry,
      });
      if (res.solved) {
        clearQwenPunishCooldown(accountId);
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
    // 2026-10-02: инжект только при живом токене слота. Протухшие сессионные
    // куки поверх живого cookie-хранилища профиля роняют сессию серверно.
    if (shouldInjectQwenCookies({ tokenExp: qwenJwtExp(authToken), nowSec: Date.now() / 1000 })) {
      const n = await applyQwenCookiesToContext(context, cookiesToInject);
      if (debug) console.log(`[qwen-proxy:${accountId}] injected ${n} cookies`);
    } else if (debug) {
      console.log(`[qwen-proxy:${accountId}] saved token expired — куки не инжектим, профиль живёт своими`);
    }
  }

  // Ждать живой токен на конкретной странице (exp в будущем), до waitMs.
  async function waitForLiveTokenOnPage(page, waitMs = 15_000) {
    const deadline = Date.now() + waitMs;
    let lastToken = null;
    while (Date.now() < deadline) {
      try {
        lastToken = await page.evaluate(() => {
          try { return (function(){var r=null;try{r=localStorage.getItem("qwen_access_token_state")}catch(e){}if(r){try{var p=JSON.parse(r);if(p&&typeof p.token==="string"&&p.token)return p.token}catch(e){}}try{return localStorage.getItem("token")||null}catch(e){return null}})() || null; } catch { return null; }
        });
      } catch {}
      if (lastToken && qwenJwtExp(lastToken) && qwenJwtExp(lastToken) > Date.now() / 1000 + 30) return lastToken;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return null;
  }

  async function primeQwenPageAuth(page) {
    if (!authToken) return;
    // 2026-10-02: праймим ТОЛЬКО живой токен. Протухший authToken в новом
    // ключе глушит SPA-минт (SPA считает себя залогиненным и не обновляется).
    if (!shouldPrimeQwenAuth({ tokenExp: qwenJwtExp(authToken), nowSec: Date.now() / 1000 })) {
      if (debug) console.log(`[qwen-proxy:${accountId}] saved token expired — не праймим, ждём SPA-минт`);
      return;
    }
    await page.evaluate((token) => {
      // cookie_gate v2 (2026-09-30): пишем в оба ключа — новый для SPA,
      // старый как fallback-хранилище для нашего же чтения.
      try {
        localStorage.setItem("token", token);
        var raw = localStorage.getItem("qwen_access_token_state");
        var st = null;
        try { st = raw ? JSON.parse(raw) : null; } catch (e) {}
        if (!st || typeof st !== "object") st = { version: 1 };
        st.token = token;
        localStorage.setItem("qwen_access_token_state", JSON.stringify(st));
      } catch {}
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
    // Warm-up навигация с ретраем на сетевых гонках (TLS/DNS): тихая смерть
    // здесь означает «окно не открылось и никто не знает почему».
    for (let attempt = 0; ; attempt += 1) {
      try {
        await worker.page.goto(QWEN_BASE_URL, { waitUntil: "domcontentloaded", timeout: QWEN_NAV_TIMEOUT_MS });
        break;
      } catch (error) {
        const plan = qwenWarmupRetryPlan({ attempt, error });
        if (plan.action !== "retry") throw error;
        console.warn(`[qwen-proxy:${accountId}] warm-up goto не прошёл (${error.message.split("\n")[0]}), ретрай через ${Math.round(plan.delayMs / 1000)}s (попытка ${attempt + 1}/${QWEN_WARMUP_RETRY_DELAYS_MS.length + 1})`);
        await new Promise((r) => setTimeout(r, plan.delayMs));
      }
    }
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
    await telemetry?.close().catch?.(() => {});
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

  // Ждать, пока SPA после reload допишет СВЕЖИЙ JWT в localStorage.
  // Инцидент 2026-09-30: SPA-refresh асинхронен, fetch сразу после reload брал
  // старый токен → повторный 401 («тихо обновлён» было самообманом).
  async function waitForFreshQwenToken(worker, { previousToken = null, waitMs = 15_000 } = {}) {
    const prevExp = qwenJwtExp(previousToken) || 0;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      try {
        const token = await worker.page.evaluate(() => {
          try { return (function(){var r=null;try{r=localStorage.getItem("qwen_access_token_state")}catch(e){}if(r){try{var p=JSON.parse(r);if(p&&typeof p.token==="string"&&p.token)return p.token}catch(e){}}try{return localStorage.getItem("token")||null}catch(e){return null}})() || null; } catch { return null; }
        });
        const exp = qwenJwtExp(token);
        if (exp && exp > Math.max(prevExp, Date.now() / 1000 + 30)) return token;
      } catch {}
      await new Promise((r) => setTimeout(r, 700));
    }
    return null;
  }

  async function reloadWorker(worker) {
    worker.currentChatId = null;
    await worker.page.goto(QWEN_BASE_URL, { waitUntil: "domcontentloaded", timeout: QWEN_NAV_TIMEOUT_MS });
    // НЕ primeQwenPageAuth: он перезаписывает свежий SPA-токен (refresh)
    // протухшим authToken из accounts.json (инцидент 2026-09-29). SPA сам
    // обновляет JWT при загрузке; authToken — только как fallback в fetch.
    await waitForQwenRuntime(worker.page);
    // Забираем свежий JWT из localStorage и обновляем слот, чтобы
    // health/ротация видели живой токен, а не протухший snapshot.
    try {
      const freshToken = await worker.page.evaluate(() => {
        try { return (function(){var r=null;try{r=localStorage.getItem("qwen_access_token_state")}catch(e){}if(r){try{var p=JSON.parse(r);if(p&&typeof p.token==="string"&&p.token)return p.token}catch(e){}}try{return localStorage.getItem("token")||null}catch(e){return null}})() || null; } catch { return null; }
      });
      if (freshToken && freshToken !== authToken) {
        const { updateAccountFromProfile } = await import("./account-store.mjs");
        if (accountId !== "default") {
          // атомарно: токен + свежие куки контекста (полусвежий слот — бомба)
          const cookies = await context.cookies("https://chat.qwen.ai").catch(() => []);
          updateAccountFromProfile(accountId, slotSyncPayload({ snapshot: { token: freshToken, cookies }, token: freshToken }));
          authToken = freshToken;
          if (debug) console.log(`[qwen-proxy:${accountId}] слот обновлён свежим JWT из SPA (${freshToken.length} chars)`);
        }
      }
    } catch {}
  }

  async function runProxyFetch(worker, { url, body, chatId, timeoutMs, streamIdleTimeoutMs, maxAttempts, alreadyAuthReloaded = false }) {
    let result = null;
    let lastError = null;
    const spanStarted = Date.now();
    const telemetrySpan = (outcome, extra = {}) => {
      telemetry?.record("fetch_span", { worker: worker.label, url: url.slice(0, 200), outcome, ms: Date.now() - spanStarted, ...extra });
    };
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
                  const token = (function(){var r=null;try{r=localStorage.getItem("qwen_access_token_state")}catch(e){}if(r){try{var p=JSON.parse(r);if(p&&typeof p.token==="string"&&p.token)return p.token}catch(e){}}try{return localStorage.getItem("token")||null}catch(e){return null}})() || authToken || "";
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
        // Baxia punish-НАВИГАЦИЯ: страница ушла на /_____tmd_____/punish во
        // время fetch → «Execution context was destroyed». Проверяем URL
        // ДО reloadWorker (он сбрасывает URL) и до слепого ретрая: re-POST в
        // активный punish только эскалирует бан (инцидент 2026-09-24).
        if (isBaxiaGuardedUrl(url) && isBaxiaNavigationError(error)) {
          const navUrl = await punishNavigationUrl(worker.page);
          if (navUrl) {
            console.warn(`[qwen-proxy:${worker.label}] Baxia punish NAVIGATION detected (text): ${navUrl.slice(0, 100)}`);
            telemetrySpan("punish_nav", { navUrl: navUrl.slice(0, 200) });
            const punishResult = await handleBaxiaPunish(worker, "nav");
            if (punishResult) { telemetrySpan("punish_cooldown"); return punishResult; }
            // Солвер решил: Baxia реплеит исходный запрос сам — результат
            // придёт следующим fetch, отдаём мягкую retry-ошибку наверх.
            break;
          }
        }
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
    // 401-in-200 (Token has expired): перезагружаем воркер — SPA сам сделает
    // auth.qwen.ai/api/v2/auths/refresh и положит свежий JWT в localStorage,
    // после чего повторяем fetch. Один релоад на вызов (не зацикливаемся).
    if (qwenNeedsAuthReload(result) && shouldAllowAuthReload({ alreadyAuthReloaded })) {
      alreadyAuthReloaded = true;
      console.warn(`[qwen-proxy:${worker.label}] 401-in-200 (token expired) — reload воркера для SPA-refresh`);
      telemetrySpan("auth_reload");
      try {
        await reloadWorker(worker);
        // 2026-09-30: SPA-refresh асинхронен — ждём свежий JWT в localStorage,
        // иначе повторный fetch брал старый токен и ловил 401 снова.
        const freshToken = await waitForFreshQwenToken(worker, { previousToken: authToken, waitMs: 15_000 });
        // Разрыв цикла: без свежего JWT ретрай — гарантированный 401 и новая
        // рекурсия reload. Отдаём ошибку наверх для ротации аккаунта.
        if (qwenAuthRetryAfterReload(freshToken) !== "retry") {
          throw new Error("auth-reload не дал свежий JWT (SPA-refresh не сработал) — нужен re-login/ротация");
        }
        return await runProxyFetch(worker, { url, body, chatId, timeoutMs, streamIdleTimeoutMs, maxAttempts: 1, alreadyAuthReloaded: true });
      } catch (reloadError) {
        console.warn(`[qwen-proxy:${worker.label}] auth-reload не помог: ${reloadError.message}`);
      }
    }
    // Baxia punish (антибот-капча): детект по contentType/text и включение
    // кулдаун, чтобы выше по стеку не долбить новыми запросами.
    if (isBaxiaGuardedUrl(url) && isQwenPunishResponse(result)) {
      const solved = await trySolvePunishOnWorker(worker, "text");
      telemetry?.record("solver_result", { worker: worker.label, path: "text-body", solved, ms: Date.now() - spanStarted });
      if (solved) {
        console.warn(`[qwen-proxy:${worker.label}] Baxia slider solved (text path) — cooldown cleared`);
      } else {
        const { backoffMs } = startQwenPunishCooldown(Date.now(), accountId);
        telemetry?.record("cooldown", { account: accountId, backoffMs });
        result = { ...result, ok: false, punish: true };
        console.warn(`[qwen-proxy:${worker.label}] Baxia punish detected — cooldown ${Math.round(backoffMs / 1000)}s (see browser window to solve captcha)`);
      }
    }
    telemetrySpan(result?.ok ? "ok" : "error", { status: result?.status });
    return result;
  }

  async function runProxyFetchStream(worker, { url, body, chatId, onRawChunk, timeoutMs, streamFirstContentTimeoutMs, streamIdleTimeoutMs, maxAttempts, alreadyAuthReloaded = false }) {
    let result = null;
    let lastError = null;
    const spanStarted = Date.now();
    const telemetrySpan = (outcome, extra = {}) => {
      telemetry?.record("fetch_span", { worker: worker.label, url: url.slice(0, 200), outcome, ms: Date.now() - spanStarted, ...extra });
    };
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
                    const token = (function(){var r=null;try{r=localStorage.getItem("qwen_access_token_state")}catch(e){}if(r){try{var p=JSON.parse(r);if(p&&typeof p.token==="string"&&p.token)return p.token}catch(e){}}try{return localStorage.getItem("token")||null}catch(e){return null}})() || authToken || "";
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
          // Baxia punish-НАВИГАЦИЯ (stream): страница ушла на punish прямо во
          // время fetch → «Execution context was destroyed». До слепого
          // ретрая проверяем URL страницы (reloadWorker его сбрасывает).
          if (isBaxiaGuardedUrl(url) && isBaxiaNavigationError(error)) {
            const navUrl = await punishNavigationUrl(worker.page);
            if (navUrl) {
              console.warn(`[qwen-proxy:${worker.label}] Baxia punish NAVIGATION detected (stream): ${navUrl.slice(0, 100)}`);
              telemetrySpan("punish_nav", { navUrl: navUrl.slice(0, 200) });
              const punishResult = await handleBaxiaPunish(worker, "nav");
              if (punishResult) {
                result = punishResult;
                // Ошибка с code=QWEN_ANTIBOT_PUNISH: client не ретраит,
                // наверх уходит понятная капча-ошибка с остатком кулдауна.
                throw createQwenPunishError(qwenAntibotCooldownRemainingMs(Date.now(), accountId));
              }
              // Солвер решил: Baxia реплеит запрос сам — выходим из ретрай-цикла.
              break;
            }
          }
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
    // 401-in-200 (Token has expired): SPA-refresh через релоад воркера (как в
    // text-пути). Стрим ещё не начался (нет first_delta), повтор безопасен.
    if (qwenNeedsAuthReload(result) && shouldAllowAuthReload({ alreadyAuthReloaded })) {
      alreadyAuthReloaded = true;
      console.warn(`[qwen-proxy:${worker.label}] 401-in-200 (token expired, stream) — reload воркера для SPA-refresh`);
      telemetrySpan("auth_reload");
      try {
        await reloadWorker(worker);
        const freshToken = await waitForFreshQwenToken(worker, { previousToken: authToken, waitMs: 15_000 });
        if (qwenAuthRetryAfterReload(freshToken) !== "retry") {
          throw new Error("auth-reload не дал свежий JWT (SPA-refresh не сработал) — нужен re-login/ротация");
        }
        return await runProxyFetchStream(worker, { url, body, chatId, onRawChunk, timeoutMs, streamFirstContentTimeoutMs, streamIdleTimeoutMs, maxAttempts: 1, alreadyAuthReloaded: true });
      } catch (reloadError) {
        console.warn(`[qwen-proxy:${worker.label}] auth-reload не помог (stream): ${reloadError.message}`);
      }
    }
    // Baxia punish (антибот-капча). Пробуем решить слайдер локально;
    // если не вышло — остаёмся на кулдауне из request-pacing.
    if (isBaxiaGuardedUrl(url) && isQwenPunishResponse(result)) {
      const solveStarted = Date.now();
      const solved = await trySolvePunishOnWorker(worker, "text");
      telemetry?.record("solver_result", { worker: worker.label, path: "text-body-stream", solved, ms: Date.now() - solveStarted });
      if (solved) {
        // Baxia сам реплеит запрос после setCookieSuccess — просто отдаём
        // результат как есть, клиент сделает новую попытку без кулдауна.
        console.warn(`[qwen-proxy:${worker.label}] Baxia slider solved (stream path) — cooldown cleared`);
      } else {
        const { backoffMs } = startQwenPunishCooldown(Date.now(), accountId);
        telemetry?.record("cooldown", { account: accountId, backoffMs });
        result = { ...result, ok: false, punish: true };
        console.warn(`[qwen-proxy:${worker.label}] Baxia punish detected (stream) — cooldown ${Math.round(backoffMs / 1000)}s`);
      }
    }
    telemetrySpan(result?.ok ? "ok" : result?.punish ? "punish" : "error", { status: result?.status });
    return result;
  }

  return {
    // Прокинуть fetch через контекст страницы. Перед запросом обязательно
    // переходим на /c/<chatId>, чтобы чат был зарегистрирован SPA-роутером.
    // Возвращает { ok, status, contentType, text } — Node парсит text сам.
    // reloadForAuth(): перезагрузить page0 и ДОЖДАТЬСЯ свежий JWT — SPA сам
    // делает auth.qwen.ai/api/v2/auths/refresh и кладёт новый токен в
    // localStorage. Читаем не первый попавшийся (инцидент 2026-09-29: успели
    // забрать СТАРЫЙ протухший токен до refresh, «тихо обновлён» был ложью),
    // а ждём токен с exp позже предыдущего, до 12с. Для внешнего тихого
    // обновления слота без второго Chromium на профиле (дубль убивал cookie-базу).
    // Ждём ЖИВОЙ токен (exp в будущем) без требования «свежее прежнего».
    // Для health-check: SPA минтит асинхронно, стрелять до минта нельзя
    // (2026-10-02: ложные invalid на живых аккаунтах).
    async waitForLiveToken({ waitMs = 15_000 } = {}) {
      const deadline = Date.now() + waitMs;
      let lastToken = null;
      while (Date.now() < deadline) {
        try {
          lastToken = await workers[0].page.evaluate(() => {
            try { return (function(){var r=null;try{r=localStorage.getItem("qwen_access_token_state")}catch(e){}if(r){try{var p=JSON.parse(r);if(p&&typeof p.token==="string"&&p.token)return p.token}catch(e){}}try{return localStorage.getItem("token")||null}catch(e){return null}})() || null; } catch { return null; }
          });
        } catch {}
        const exp = qwenJwtExp(lastToken);
        if (lastToken && exp && exp > Date.now() / 1000 + 30) return lastToken;
        await new Promise((r) => setTimeout(r, 1000));
      }
      return null;
    },

    // Свежий снапшот сессии (токен из localStorage + куки контекста) —
    // для атомарного синка слота в health-check/refresh. Куки обязательны:
    // живой токен + старые куки в слоте = инжект мусора при следующем старте.
    async exportSessionSnapshot() {
      const token = await waitForLiveTokenOnPage(workers[0].page, 15_000);
      const cookies = await context.cookies("https://chat.qwen.ai");
      return { token, cookies };
    },

    // Диагностика: URL + слепок auth-ключей localStorage воркера.
    async debugTokenState() {
      return await workers[0].page.evaluate(() => {
        const out = { url: location.href };
        try { out.state = (localStorage.getItem("qwen_access_token_state") || "").slice(0, 80); } catch (e) { out.state = "<err>"; }
        try { out.legacy = (localStorage.getItem("token") || "").slice(0, 40); } catch (e) { out.legacy = "<err>"; }
        try { out.loggedOut = Boolean(localStorage.getItem("qwen_token_logged_out_marker")); } catch (e) {}
        return out;
      });
    },

    async reloadForAuth({ previousToken = null, waitMs = 12_000 } = {}) {
      const worker = workers[0];
      await reloadWorker(worker);
      const prevExp = qwenJwtExp(previousToken) || 0;
      const deadline = Date.now() + waitMs;
      let lastToken = null;
      while (Date.now() < deadline) {
        try {
          lastToken = await worker.page.evaluate(() => {
            try { return (function(){var r=null;try{r=localStorage.getItem("qwen_access_token_state")}catch(e){}if(r){try{var p=JSON.parse(r);if(p&&typeof p.token==="string"&&p.token)return p.token}catch(e){}}try{return localStorage.getItem("token")||null}catch(e){return null}})() || null; } catch { return null; }
          });
        } catch {}
        if (lastToken && qwenJwtExp(lastToken) > Math.max(prevExp, Date.now() / 1000 + 30)) return lastToken;
        await new Promise((r) => setTimeout(r, 1000));
      }
      return lastToken; // даже старый — пусть вызывающий решит (может, он жив)
    },
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
            const headers = {
              "content-type": "application/json",
              accept: "application/json, text/plain, */*",
              source: "web",
            };
            // 2026-09-29: auth теперь в Bearer-JWT (localStorage), куки-токена
            // нет. Файловые эндпоинты (getstsToken/parse) без Authorization
            // отвечали 200 с пустым телом → "no file_id" (инцидент с DOCX).
            try {
              const token = (function(){var r=null;try{r=localStorage.getItem("qwen_access_token_state")}catch(e){}if(r){try{var p=JSON.parse(r);if(p&&typeof p.token==="string"&&p.token)return p.token}catch(e){}}try{return localStorage.getItem("token")||null}catch(e){return null}})();
              if (token) headers.Authorization = `Bearer ${token}`;
            } catch {}
            const res = await fetch(path, {
              method: "POST",
              headers,
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
            const headers = {
              accept: "application/json, text/plain, */*",
              source: "web",
            };
            // Bearer-JWT из localStorage — куки-токена больше нет (2026-09-29).
            try {
              const token = (function(){var r=null;try{r=localStorage.getItem("qwen_access_token_state")}catch(e){}if(r){try{var p=JSON.parse(r);if(p&&typeof p.token==="string"&&p.token)return p.token}catch(e){}}try{return localStorage.getItem("token")||null}catch(e){return null}})();
              if (token) headers.Authorization = `Bearer ${token}`;
            } catch {}
            const res = await fetch(path, {
              method: "GET",
              headers,
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
