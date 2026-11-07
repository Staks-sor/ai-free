// Health-check pool-аккаунтов Qwen. ВАЖНО (инцидент 2026-09-25): Qwen
// отдаёт HTTP 200 с error-телом внутри («Unauthorized» в JSON при дохлых
// куках), а старый эндпоинт /api/v2/models/ вообще 200-ит БЕЗ авторизации —
// health-check по статусу воскрешал мёртвые аккаунты через markValid.
// Поэтому: эндпоинт /chats (требует auth) + парсинг тела.

import { loadAccounts, markRateLimited, markQwenAuthFailure, saveAccounts } from "./account-store.mjs";

// exp из JWT-клейма (payload base64url) — 0 при мусоре.
function tokenExpOf(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
    return Number(payload?.exp) || 0;
  } catch {
    return 0;
  }
}

const CHATS_URL = "https://chat.qwen.ai/api/v2/chats?page_size=1";

function rateLimitHoursFromBody(json) {
  const n = Number(json?.num ?? json?.data?.num);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

/**
 * Классифицировать ответ health-запроса: OK | UNAUTHORIZED | RATELIMIT | ERROR.
 * СТРОГО (инцидент 2026-09-29): OK только при явном success:true в JSON.
 * Не-JSON (WAF-заглушка, HTML, пусто) и JSON без success — ERROR:
 * валидность не подтверждена, воскрешать аккаунт нельзя. Статус один
 * недостаточен — 200 может нести Unauthorized внутри, а WAF — HTML на 200.
 */
export function classifyQwenHealthResponse(status, bodyText) {
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 429) return "RATELIMIT";
  if (status >= 500) return "ERROR";
  let json = null;
  try { json = JSON.parse(bodyText); } catch { return "ERROR"; }
  if (json?.success !== true) {
    const code = String(json?.data?.code ?? json?.code ?? "");
    if (/unauthorized|forbidden|not.?logged/i.test(code)) return "UNAUTHORIZED";
    if (/rate.?limit/i.test(code)) return "RATELIMIT";
    return "ERROR";
  }
  return "OK";
}

/**
 * Применить вердикт health-check к аккаунту. Ключевая семантика:
 * - OK НЕ выводит из кулдауна (resetAt нетронут) — чтение /chats
 *   работает даже у зафлагованных аккаунтов, это ничего не доказывает
 *   про пишущие операции (инциденты RGV587). invalid снимается.
 * - UNAUTHORIZED при живом JWT → кулдаун (риск-флаг), при мёртвом → invalid.
 * - ERROR → состояние не меняется (WAF/сеть/таймаут не лечат и не калечат).
 */
export function applyQwenHealthVerdict(accountId, verdict, { hours } = {}) {
  if (verdict === "OK") {
    // снимаем ТОЛЬКО invalid; кулдаун живёт свой срок
    const accounts = loadAccounts();
    const idx = accounts.findIndex((a) => a.id === accountId);
    if (idx !== -1 && accounts[idx].invalid) {
      accounts[idx].invalid = false;
      saveAccountsLite(accounts);
    }
    return;
  }
  if (verdict === "UNAUTHORIZED") {
    markQwenAuthFailure(accountId);
    return;
  }
  if (verdict === "RATELIMIT") {
    markRateLimited(accountId, hours ?? 24);
    return;
  }
  // ERROR: ничего не делаем
}

function saveAccountsLite(accounts) {
  // markValid стирал resetAt — поэтому пишем напрямую, сохраняя кулдаун
  saveAccounts(accounts);
}

// Путь health-запроса: живой прокси-воркер (SPA-минт + подписанный fetch
// из-под страницы) — единственный честный путь после cookie_gate v2
// (2026-09-30): прямой fetch из Node протухшим сохранённым токеном валит
// в unauthorized ЖИВЫЕ аккаунты. Direct — только если прокси недоступен.
export function qwenHealthRequestPath({ hasProxy } = {}) {
  return hasProxy ? "proxy" : "direct";
}

// Минт-гейт для health: SPA минтит токен асинхронно после загрузки; просить
// /chats ДО минта = стрелять протухшим Bearer и ложно валить живой аккаунт
// (2026-10-02, nenigumi: /chats success:true на свежем минте, health говорил
// «недействителен»). Живой минт = exp в будущем; тогда же синкаем слот.
export function qwenHealthSyncsMintedToken({ mintedTokenExp, nowSec } = {}) {
  return Boolean(mintedTokenExp && mintedTokenExp > nowSec);
}

// Direct-ветка (fallback): GET /chats с cookie аккаунта + разбор тела.
async function testQwenAccountDirect(accountId, { timeoutMs = 15_000 } = {}) {
  const account = loadAccounts().find((a) => a.id === accountId);
  if (!account) return { verdict: "ERROR", reason: "account not found" };
  if (!account.cookieHeader && !account.token) {
    return { verdict: "ERROR", reason: "no cookie/token stored" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      Accept: "application/json, text/plain, */*",
      source: "web",
    };
    if (account.cookieHeader) headers.Cookie = account.cookieHeader;
    else if (account.token) headers.Cookie = `token=${account.token};`;

    const res = await fetch(CHATS_URL, { headers, signal: controller.signal });
    const bodyText = await res.text().catch(() => "");
    const verdict = classifyQwenHealthResponse(res.status, bodyText);

    const hours = verdict === "RATELIMIT" ? rateLimitHoursFromBody(safeJsonParse(bodyText)) : undefined;
    applyQwenHealthVerdict(accountId, verdict, { hours });
    return { verdict, status: res.status, ...(hours ? { hours } : {}) };
  } catch (error) {
    return { verdict: "ERROR", reason: error.name === "AbortError" ? "timeout" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// Проверка одного аккаунта: сначала через прокси-воркер (честный путь),
// при недоступности прокси — прямой fetch (legacy, может ложно валить
// живые аккаунты протухшим токеном — см. qwenHealthRequestPath).
export async function testQwenAccount(accountId, opts = {}) {
  let proxy = null;
  try {
    const proxyModule = await import("./browser-proxy.mjs");
    proxy = await proxyModule.getQwenBrowserProxy({ accountId }).catch(() => null);
  } catch {}
  const path = qwenHealthRequestPath({ hasProxy: Boolean(proxy?.proxyApiGet) });
  if (path === "proxy") {
    try {
      // Гонка минта (2026-10-02): страница только загрузилась, SPA ещё не
      // наминтил свежий JWT — ждём живой токен (exp в будущем) до 15с, иначе
      // /chats уйдёт с протухшим Bearer из localStorage.
      if (proxy.waitForLiveToken) {
        const liveToken = await proxy.waitForLiveToken({ waitMs: 15_000 });
        if (liveToken && qwenHealthSyncsMintedToken({ mintedTokenExp: tokenExpOf(liveToken), nowSec: Date.now() / 1000 })) {
          const { updateAccountFromProfile } = await import("./account-store.mjs");
          const { shouldSyncCookieSnapshot } = await import("./browser-proxy.mjs");
          const { slotSyncPayload } = await import("./browser-proxy.mjs");
          const snap = await proxy.exportSessionSnapshot?.().catch(() => null);
          updateAccountFromProfile(accountId, slotSyncPayload({ snapshot: snap, token: liveToken }));
        }
      }
      const res = await proxy.proxyApiGet({ path: "https://chat.qwen.ai/api/v2/chats?page_size=1", timeoutMs: opts.timeoutMs ?? 15_000 });
      const bodyText = res?.json ? JSON.stringify(res.json) : "";
      const verdict = classifyQwenHealthResponse(res?.status ?? 0, bodyText);
      const hours = verdict === "RATELIMIT" ? rateLimitHoursFromBody(res?.json ?? null) : undefined;
      applyQwenHealthVerdict(accountId, verdict, { hours });
      return { verdict, status: res?.status, ...(hours ? { hours } : {}), via: "proxy" };
    } catch {
      // прокси есть, но запрос не прошёл — не калечим аккаунт direct-ом:
      // возвращаем ERROR (состояние не меняется), причину сохраняем
      return { verdict: "ERROR", reason: "proxy request failed", via: "proxy" };
    }
  }
  return await testQwenAccountDirect(accountId, opts);
}

// Проверка всех pool-аккаунтов (для меню и CLI).
export async function testQwenAccounts() {
  const accounts = loadAccounts();
  const results = [];
  for (const account of accounts) {
    const result = await testQwenAccount(account.id);
    results.push({ id: account.id, ...result });
  }
  return results;
}
