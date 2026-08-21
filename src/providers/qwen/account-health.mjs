// Health-check pool-аккаунтов Qwen: лёгкий GET /api/v2/models/ с cookie
// аккаунта (пинг по образцу testToken FreeQwenAPI, но без тяжёлого
// completions-POST, который отдаёт 504). Вердикт OK / UNAUTHORIZED /
// RATELIMIT / ERROR + авто-обновление статуса в хранилище.

import { loadAccounts, markValid, markInvalid, markRateLimited } from "./account-store.mjs";

const MODELS_URL = "https://chat.qwen.ai/api/v2/models/";

function rateLimitHoursFromBody(json) {
  const n = Number(json?.num ?? json?.data?.num);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

// Проверка одного аккаунта: прямой fetch с его cookieHeader.
// 401/403 -> invalid, 429 -> cooldown, 200/400 -> жив.
export async function testQwenAccount(accountId, { timeoutMs = 15_000 } = {}) {
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

    const res = await fetch(MODELS_URL, { headers, signal: controller.signal });

    if (res.ok || res.status === 400) {
      markValid(accountId);
      return { verdict: "OK", status: res.status };
    }
    if (res.status === 401 || res.status === 403) {
      markInvalid(accountId);
      return { verdict: "UNAUTHORIZED", status: res.status };
    }
    if (res.status === 429) {
      const json = await res.json().catch(() => null);
      const hours = rateLimitHoursFromBody(json);
      markRateLimited(accountId, hours);
      return { verdict: "RATELIMIT", status: 429, hours };
    }
    return { verdict: "ERROR", status: res.status };
  } catch (error) {
    return { verdict: "ERROR", reason: error.name === "AbortError" ? "timeout" : error.message };
  } finally {
    clearTimeout(timer);
  }
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
