// Логин через Playwright: открытие окна, ожидание авторизации, снятие cookies + userToken.
// Здесь же — autofill из credentials, тихий refresh, очистка сессии.

import fs from "node:fs";
import { BASE_URL, DEFAULT_BROWSER_PROFILE } from "../config.mjs";
import {
  cookieHeaderFromArray,
  normalizeToken,
  writeSavedAuth,
} from "../auth/files.mjs";
import { loadCredentials } from "../auth/credentials.mjs";
import { launchPersistentDeepSeekContext } from "./launch.mjs";

// Полный flow: открыть видимое окно → автозаполнить (если есть creds) →
// ждать сетевой сигнал успешного логина → снять токен → сохранить → закрыть.
export async function loginAndSaveAuth(authFile) {
  const profileDir = DEFAULT_BROWSER_PROFILE;
  const { chromium } = await import("playwright");
  const context = await launchPersistentDeepSeekContext(chromium, profileDir, false);
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  const credentials = loadCredentials();
  if (credentials) {
    console.log("🤖 Trying automatic login from saved credentials...");
    const autofilled = await tryAutofillLogin(page, credentials);
    if (autofilled) {
      console.log("⏳ Forms submitted, ждём подтверждения от сервера...");
    } else {
      console.log("⚠️ Autofill не прошёл (другие селекторы / captcha / Google OAuth). Залогинься в окне вручную.");
    }
  }
  console.log("🔓 DeepSeek login window открыто.");
  console.log("   • Залогинься любым способом (Google OAuth, email/пароль).");
  console.log("   • НИЧЕГО нажимать в терминале не нужно.");
  console.log("   • Окно закроется автоматически, как только фронт сделает первый авторизованный API-вызов.");

  try {
    await waitForAuthenticatedApiCall(context);
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }

  let captured;
  try {
    captured = await captureAuthFromContext(context, page);
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }

  writeSavedAuth(authFile, {
    cookies: captured.cookies,
    userToken: captured.userToken,
    profileDir,
  });
  await context.close();

  console.log("✅ Логин подтверждён (фронт обратился к DeepSeek API с валидным токеном).");
  console.log(`💾 Saved auth to ${authFile}`);
  return {
    token: captured.token,
    cookieHeader: cookieHeaderFromArray(captured.cookies),
    source: authFile,
  };
}

// Самый надёжный сигнал «юзер залогинен»: первый успешный (200 OK + code 0)
// API-запрос с заголовком Authorization: Bearer. До логина таких запросов нет.
export async function waitForAuthenticatedApiCall(context, { timeoutMs = 5 * 60 * 1000, settleMs = 800 } = {}) {
  return await new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      context.off("response", handler);
      reject(
        new Error(
          `Login timed out after ${Math.round(timeoutMs / 1000)}s. Залогинься в открывшемся окне DeepSeek и подожди — окно закроется автоматически.`,
        ),
      );
    }, timeoutMs);

    const handler = async (response) => {
      if (done) return;
      try {
        const url = response.url();
        if (!url.includes("/api/v0/")) return;
        if (response.status() !== 200) return;
        const reqHeaders = response.request().headers();
        const authHdr = reqHeaders["authorization"] || reqHeaders["Authorization"];
        if (!authHdr || !/^Bearer\s+\S{10,}/.test(authHdr)) return;
        let body = null;
        try { body = await response.json(); } catch { return; }
        if (body && body.code !== undefined && body.code !== 0) return;

        done = true;
        clearTimeout(timer);
        context.off("response", handler);
        setTimeout(resolve, settleMs);
      } catch {}
    };

    context.on("response", handler);
  });
}

// Снимок auth прямо из открытого browser context.
export async function captureAuthFromContext(context, page) {
  let cookies = [];
  let rawToken = null;
  try {
    cookies = await context.cookies(BASE_URL);
    rawToken = await page
      .evaluate(() => {
        try { return localStorage.getItem("userToken"); } catch { return null; }
      })
      .catch(() => null);
  } catch {
    throw new Error("Не удалось прочитать состояние из окна (возможно, его уже закрыли).");
  }
  const token = normalizeToken(rawToken || "");
  const hasSessionCookie = cookies.some((cookie) => cookie.name === "ds_session_id");
  if (!token) {
    throw new Error("В localStorage нет userToken. Кажется, ты нажал Enter до того, как залогинился.");
  }
  if (!hasSessionCookie) {
    throw new Error("В куках нет ds_session_id. Логин, видимо, не завершён.");
  }
  return { cookies, userToken: rawToken, token };
}

// Автозаполнение формы логина DeepSeek (email + password + Sign in). Defensive:
// любые поломки селекторов / captcha / OAuth — возвращают false, юзер закончит руками.
export async function tryAutofillLogin(page, credentials) {
  if (!credentials?.email || !credentials?.password) return false;
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});

    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[autocomplete="username"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="Email" i]',
      'input[placeholder*="почт" i]',
    ];
    const emailInput = await firstVisibleLocator(page, emailSelectors, 5000);
    if (!emailInput) return false;
    await emailInput.fill(credentials.email);

    let passwordInput = await firstVisibleLocator(page, ['input[type="password"]'], 1500);

    if (!passwordInput) {
      const continueBtn = await firstVisibleLocator(page, [
        'button[type="submit"]',
        'button:has-text("Continue")',
        'button:has-text("Next")',
        'button:has-text("Далее")',
        'button:has-text("Продолжить")',
      ], 1500);
      if (continueBtn) {
        await continueBtn.click({ timeout: 3000 }).catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      }
      passwordInput = await firstVisibleLocator(page, ['input[type="password"]'], 5000);
    }
    if (!passwordInput) return false;
    await passwordInput.fill(credentials.password);

    const submitBtn = await firstVisibleLocator(page, [
      'button[type="submit"]',
      'button:has-text("Sign in")',
      'button:has-text("Log in")',
      'button:has-text("Войти")',
    ], 2000);
    if (!submitBtn) return false;
    await submitBtn.click({ timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function firstVisibleLocator(page, selectors, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      const visible = await locator.isVisible().catch(() => false);
      if (visible) return locator;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

// Polling-вход с детекцией СМЕНЫ токена. Используется legacy-flow, основной — waitForAuthenticatedApiCall.
export async function pollForValidAuth(context, page, { timeoutMs = 5 * 60 * 1000, intervalMs = 1500 } = {}) {
  const readToken = () =>
    page
      .evaluate(() => {
        try { return localStorage.getItem("userToken"); } catch { return null; }
      })
      .catch(() => null);

  const initialRaw = await readToken();
  const initialToken = normalizeToken(initialRaw || "");

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    let cookies = [];
    let rawToken = null;
    try {
      cookies = await context.cookies(BASE_URL);
      rawToken = await readToken();
    } catch {
      throw new Error("Login window was closed before authentication completed.");
    }
    const token = normalizeToken(rawToken || "");
    const hasSessionCookie = cookies.some((cookie) => cookie.name === "ds_session_id");
    const tokenChanged = token && token !== initialToken;
    if (tokenChanged && hasSessionCookie) {
      return { cookies, userToken: rawToken, token };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `Login timed out after ${Math.round(timeoutMs / 1000)}s. Залогинься в открывшемся окне и подожди — окно закроется само.`,
  );
}

// Тихий refresh из persistent профиля. Если профиль ещё жив, токен обновится молча.
export async function refreshAuthFromProfile(authFile) {
  const saved = JSON.parse(fs.readFileSync(authFile, "utf8"));
  const profileDir = saved.profileDir || DEFAULT_BROWSER_PROFILE;
  const { chromium } = await import("playwright");
  const context = await launchPersistentDeepSeekContext(chromium, profileDir, true);
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const auth = await collectAuthFromContext(context, page, authFile, profileDir);
  await context.close();
  return auth;
}

async function collectAuthFromContext(context, page, authFile, profileDir) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  const cookies = await context.cookies(BASE_URL);
  const userToken = await page.evaluate(() => localStorage.getItem("userToken")).catch(() => "");
  const token = normalizeToken(userToken);

  if (!token) {
    throw new Error("Could not read localStorage userToken. Make sure you are logged in.");
  }
  if (!cookies.some((cookie) => cookie.name === "ds_session_id")) {
    throw new Error("Could not read ds_session_id cookie. Make sure DeepSeek is logged in.");
  }

  writeSavedAuth(authFile, { cookies, userToken, profileDir });
  return {
    token,
    cookieHeader: cookieHeaderFromArray(cookies),
    source: authFile,
  };
}

// Чистим cookies DeepSeek в профиле, чтобы сервер показал форму логина.
// localStorage НЕ трогаем — это ломало персистентный профиль раньше.
export async function clearProfileSession(profileDir) {
  const { chromium } = await import("playwright");
  const context = await launchPersistentDeepSeekContext(chromium, profileDir, true);
  try {
    await context.clearCookies();
  } finally {
    await context.close().catch(() => {});
  }
}
