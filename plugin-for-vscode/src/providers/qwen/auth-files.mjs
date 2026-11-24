// IO для Qwen-auth.json. Структура аналогична deepseek/auth/files.mjs,
// но с другим набором полей под их API.
//
// Хранимое:
// {
//   "version": 1,
//   "savedAt": ISO timestamp,
//   "baseUrl": "https://chat.qwen.ai",
//   "profileDir": "/Users/.../qwen-browser-profile",
//   "token": "eyJ...",         ← JWT из куки `token` или localStorage
//   "userId": "5be644f7-...",  ← cnaui (опционально)
//   "cookies": [               ← массив cookies в Playwright-формате
//     { name, value, domain, path, httpOnly, secure, ... },
//     ...
//   ]
// }

import fs from "node:fs";
import { writeAtomicJsonSync } from "../../state/state-writer.mjs";
import { QWEN_BASE_URL } from "./config.mjs";

export function readQwenAuth(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    const cookies = Array.isArray(raw.cookies) ? raw.cookies : [];
    return {
      token: raw.token || "",
      userId: raw.userId || "",
      cookieHeader: qwenCookieHeaderFromArray(cookies),
      cookies,
      profileDir: raw.profileDir || "",
      source: file,
    };
  } catch {
    return null;
  }
}

export function writeQwenAuth(file, { cookies, token, userId, profileDir }) {
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    baseUrl: QWEN_BASE_URL,
    profileDir,
    token,
    userId,
    cookies,
  };
  writeAtomicJsonSync(file, payload);
}

// Cookie-заголовок из массива Playwright-cookies. Включает ВСЕ куки,
// которые относятся к qwen.ai (включая антибот-токены типа tfstk, isg, acw_tc и т.п.).
// Иначе их антибот-движок может отрезать запросы.
export function qwenCookieHeaderFromArray(parsed) {
  if (!Array.isArray(parsed)) {
    throw new Error("Qwen cookie data must be an array from Playwright context.cookies().");
  }
  const usable = parsed.filter((cookie) => cookie?.name && "value" in cookie);
  return usable.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

// Playwright addCookies() ожидает объекты с domain/path. Нормализуем сохранённые куки.
export function playwrightCookiesFromSaved(cookies) {
  if (!Array.isArray(cookies)) return [];
  return cookies
    .filter((c) => c?.name && "value" in c)
    .map((c) => {
      const entry = {
        name: String(c.name),
        value: String(c.value),
        domain: String(c.domain || ".qwen.ai"),
        path: String(c.path || "/"),
        httpOnly: Boolean(c.httpOnly),
        secure: Boolean(c.secure),
        sameSite: c.sameSite || "Lax",
      };
      if (typeof c.expires === "number" && c.expires > 0) {
        entry.expires = c.expires;
      }
      return entry;
    });
}

// Подмешать куки из auth.json в Chromium-контекст (browser-proxy / refresh).
// Без этого import-qwen и рассинхрон профиля с auth.json ломают «авто»-вход.
export async function applyQwenCookiesToContext(context, cookies, { preserveSession = false } = {}) {
  let normalized = playwrightCookiesFromSaved(cookies);
  if (preserveSession) {
    const current = await context.cookies(QWEN_BASE_URL);
    normalized = normalized.filter(cookie => {
      const existing = current.find(item => item.name === cookie.name && item.domain === cookie.domain && item.path === cookie.path);
      if (!existing) return true;
      if (cookie.name === 'refresh_token') return false;
      if (cookie.name === 'token') {
        const expires = value => { try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString()).exp || 0; } catch { return 0; } };
        return expires(cookie.value) > expires(existing.value);
      }
      return true;
    });
  }
  if (!normalized.length) return 0;
  await context.addCookies(normalized);
  return normalized.length;
}

// Serialized into the Qwen page. Seed imported auth without undoing SPA renewal.
export function seedQwenPageToken(token) {
  try {
    const current = localStorage.getItem('token');
    const expires = value => {
      try { return JSON.parse(atob(value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp || 0; }
      catch { return 0; }
    };
    let state;
    try { state = JSON.parse(localStorage.getItem('qwen_access_token_state') || 'null'); } catch {}
    const validState = state?.version === 1 && typeof state.stateId === 'string' && state.stateId
      && typeof state.token === 'string' && state.token && Number.isFinite(state.expiresAt)
      && Number.isFinite(state.updatedAt) && typeof state.sourceId === 'string';
    const browserToken = validState && expires(state.token) > expires(current) ? state.token : current;
    const chosen = !browserToken || expires(token) > expires(browserToken) ? token : browserToken;
    if (chosen !== current) localStorage.setItem('token', chosen);
    const expiresAt = expires(chosen) * 1000;
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) return;
    localStorage.setItem('at_expire_time', String(expiresAt));
    // Qwen's current token manager reads this state before the legacy token.
    if (expiresAt > Date.now() && (!validState || state.token !== chosen || state.expiresAt !== expiresAt)) {
      localStorage.setItem('qwen_access_token_state', JSON.stringify({ version: 1,
        stateId: `synvox-${Date.now()}-${Math.random().toString(36).slice(2)}`, token: chosen,
        expiresAt, updatedAt: Date.now(), sourceId: 'synvox' }));
    }
  } catch {}
}
