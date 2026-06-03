// Авторизация: чтение/запись auth.json, парсинг cookie-файла, нормализация токена.
// Никаких Playwright-зависимостей здесь нет — только синхронные IO и парсеры.
// Все network/browser штуки делает src/browser/login.mjs.

import fs from "node:fs";
import path from "node:path";
import { BASE_URL } from "../config.mjs";

// Нормализация userToken: фронт DeepSeek хранит его в localStorage либо как сырую строку,
// либо как JSON-обёртку {"value":"...","__version":"0"}. Тянем "value", если можем.
export function normalizeToken(inputToken) {
  const token = String(inputToken || "").trim();
  if (!token) return "";

  try {
    const parsed = JSON.parse(token);
    if (typeof parsed === "string") return parsed.trim();
    if (parsed && typeof parsed.value === "string") return parsed.value.trim();
  } catch {
    // обычная строка localStorage
  }

  return token;
}

export function loadCookies(file) {
  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw);
  return cookieHeaderFromArray(parsed);
}

export function cookieHeaderFromArray(parsed) {
  if (!Array.isArray(parsed)) {
    throw new Error("Cookie data must be a JSON array exported from the browser.");
  }

  const usable = parsed.filter((cookie) => cookie?.name && "value" in cookie);
  if (!usable.some((cookie) => cookie.name === "ds_session_id")) {
    throw new Error("Cookie file does not contain ds_session_id.");
  }

  return usable
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export function readSavedAuth(file) {
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!parsed || typeof parsed !== "object") return null;

  const token = normalizeToken(parsed.userToken || parsed.token || "");
  const cookieHeader = cookieHeaderFromArray(parsed.cookies || []);
  return { token, cookieHeader, source: file };
}

export function writeSavedAuth(file, { cookies, userToken, profileDir }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    profileDir,
    userToken,
    cookies,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows / некоторые FS — chmod игнорируется, это ок
  }
}

// .env.example по дефолту содержит "paste_userToken_here" — это плейсхолдер.
// Если такой "токен" попал в args, считаем, что токена нет.
export function isPlaceholderToken(token) {
  if (!token) return true;
  const lowered = String(token).toLowerCase();
  return (
    lowered.includes("paste_") ||
    lowered.includes("your_token") ||
    lowered === "..." ||
    lowered.length < 8
  );
}

// resolveAuth решает, откуда взять auth для текущего запуска:
// 1) --login → принудительно открыть окно логина
// 2) auth.json есть → читаем кэш (lazy mode, без Chromium)
// 3) --cookies + --token и они валидные → ручной режим
// 4) ничего нет → открываем окно логина впервые
//
// Параметры loginAndSaveAuth и refreshAuthFromProfile принимаются как функции,
// чтобы избежать циклической зависимости с browser/login.mjs.
export async function resolveAuth(args, { loginAndSaveAuth, refreshAuthFromProfile }) {
  if (args.login) {
    return await loginAndSaveAuth(args.authFile);
  }

  if (fs.existsSync(args.authFile)) {
    try {
      const saved = readSavedAuth(args.authFile);
      if (args.debug) {
        console.error("[auth] using cached auth (lazy); refresh deferred until first API failure.");
      }
      return saved;
    } catch (error) {
      if (args.debug) {
        console.error(`[debug] cached auth unreadable, falling back to profile refresh: ${error.message}`);
      }
      try {
        return await refreshAuthFromProfile(args.authFile);
      } catch (refreshError) {
        if (args.debug) {
          console.error(`[debug] profile refresh also failed: ${refreshError.message}`);
        }
      }
    }
  }

  if (args.token && args.cookies && fs.existsSync(args.cookies) && !isPlaceholderToken(args.token)) {
    return {
      token: args.token,
      cookieHeader: loadCookies(args.cookies),
      source: args.cookies,
    };
  }

  console.log("ℹ️ Нет сохранённой авторизации. Открываю окно DeepSeek для первого входа...");
  return await loginAndSaveAuth(args.authFile);
}
