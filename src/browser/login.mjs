// Логин через Playwright: открытие окна, ожидание авторизации, снятие cookies + userToken.
// Здесь же — autofill из credentials, тихий refresh, очистка сессии.

import fs from "node:fs";
import path from "node:path";
import { BASE_URL, DEFAULT_AUTH_FILE } from "../config.mjs";
import {
  cookieHeaderFromArray,
  normalizeToken,
  writeSavedAuth,
} from "../auth/files.mjs";
import { CAMOUFOX_RUNTIME_ROOT, launchCamoufoxSession } from "./camoufox-runtime.mjs";
import { createFileLogger } from '../logging/logger.mjs';
const captchaLogger = createFileLogger({ component: 'deepseek-captcha' });

const DEEPSEEK_STORAGE_STATE = path.join(CAMOUFOX_RUNTIME_ROOT, "deepseek", "storage-state.json");

export function deepSeekCamoufoxOptions(headless, options = {}) {
  return { headless, viewport: { width: 1280, height: 860 }, storageStatePath: DEEPSEEK_STORAGE_STATE, ...options };
}

export function captchaResultSummary(status, body) {
  const result = { status, pass: typeof body?.pass === 'boolean' ? body.pass : null };
  if (typeof body?.error === "string" && /^[a-z0-9_-]{1,60}$/i.test(body.error)) result.error = body.error;
  if (Array.isArray(body?.['error-codes'])) {
    const codes = body['error-codes'].filter(code => typeof code === 'string' && /^[a-z0-9_-]{1,60}$/i.test(code)).slice(0, 10);
    if (codes.length) result.errorCodes = codes;
  }
  return result;
}

export function observeDeepSeekCaptcha(context, onProgress = () => {}) {
  let active = true;
  const handler = async response => {
    if (!/^https:\/\/api\.hcaptcha\.com\/checkcaptcha\//.test(response.url())) return;
    const body = await response.json().catch(() => null);
    if (!active) return;
    const result = captchaResultSummary(response.status(), body);
    captchaLogger.info('captcha.result', { provider: 'deepseek', resource: 'deepseek-captcha', status: result.status,
      captchaResult: result.pass === true ? 'passed' : result.pass === false ? 'rejected' : 'unknown',
      captchaErrorCodes: [result.error, ...(result.errorCodes || [])].filter(Boolean) });
    console.error('[deepseek-captcha]', JSON.stringify(result));
    const message = result.pass === true ? 'Проверка hCaptcha подтверждена. Завершите вход в DeepSeek в открытом окне.'
      : result.pass === false ? 'hCaptcha не подтвердила эту попытку. Повторите проверку вручную в открытом окне; вход ещё не завершён.'
      : 'Результат hCaptcha не определён. Вход ещё не подтверждён; проверьте открытое окно браузера.';
    const codes = [result.error, ...(result.errorCodes || [])].filter(Boolean);
    onProgress({ phase: 'captcha', message: message + (codes.length ? ' Код: ' + codes.join(', ') + '.' : '') });
  };
  context.on('response', handler);
  return () => { active = false; context.off('response', handler); };
}

export async function loginAndSaveAuth(authFile, options = {}) {
  const session = await launchCamoufoxSession(deepSeekCamoufoxOptions(false, options));
  let lastProgress = null;
  const stopCaptchaObserver = observeDeepSeekCaptcha(session.context, progress => {
    lastProgress = progress;
    options.onProgress?.(progress);
  });
  console.log("🔓 DeepSeek открыт в Camoufox.");
  console.log("   • Залогинься любым способом (Google OAuth, email/пароль).");
  console.log("   • НИЧЕГО нажимать в терминале не нужно.");
  console.log("   • Окно закроется автоматически после подтверждённого входа.");

  let captured;
  try {
    await session.page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForAuthenticatedApiCall(session.context, {
      page: session.page,
      onAuthenticated: async (authenticatedPage) => {
        captured = await captureAuthFromContext(session.context, authenticatedPage);
      },
    });
    writeSavedAuth(authFile, {
      cookies: captured.cookies,
      userToken: captured.userToken,
      profileDir: options.profileDir || options.storageStatePath || DEEPSEEK_STORAGE_STATE,
      hifLeim: captured.hifLeim,
      hifDliq: captured.hifDliq,
    });
    options.onProgress?.({ phase: 'closing', message: 'Данные входа DeepSeek сохранены. Завершаем закрытие браузера…' });
  } catch (error) {
    if (error.code === 'DEEPSEEK_LOGIN_TIMEOUT' && lastProgress) {
      error.userMessage = 'Вход в DeepSeek не завершён: проверка hCaptcha не привела к подтверждённой авторизации. Нажмите «Переподключить» и завершите вход в новом окне браузера.';
    }
    throw error;
  } finally {
    stopCaptchaObserver();
    await session.close();
  }

  console.log("✅ Логин подтверждён (фронт обратился к DeepSeek API с валидным токеном).");
  console.log(`💾 Saved auth to ${authFile}`);
  return {
    token: captured.token,
    cookieHeader: cookieHeaderFromArray(captured.cookies, { requireSession: false }),
    hifLeim: captured.hifLeim,
    hifDliq: captured.hifDliq,
    source: authFile,
  };
}

// Токен и cookie могут оставаться от устаревшей сессии: подтверждаем их у DeepSeek
// до сохранения и не закрываем окно при переходе между страницами OAuth.
export async function waitForAuthenticatedApiCall(context, { page = null, timeoutMs = 10 * 60 * 1000, pollMs = 1000, emptyPagesGraceMs = 2000, settleMs = 0, onAuthenticated = null } = {}) {
  return await new Promise((resolve, reject) => {
    let done = false;
    let checking = false;
    let emptyPagesSince = 0;
    let lastValidation = { key: "", at: 0, valid: false };
    const authenticatedDeepSeekPage = async () => {
      const candidates = typeof context.pages === "function"
        ? context.pages().filter((candidate) => candidate.url().startsWith(BASE_URL))
        : page ? [page] : [];
      for (const candidate of candidates) {
        try {
          const snapshot = await candidate.evaluate(() => ({ path: location.pathname, token: localStorage.getItem("userToken") }));
          const token = normalizeToken(snapshot.token);
          if (/\/(?:sign_in|login|auth)(?:\/|$)/i.test(snapshot.path) || !token) continue;
          const key = token;
          if (lastValidation.key !== key || Date.now() - lastValidation.at >= 3000) {
            lastValidation = { key, at: Date.now(), valid: await validateDeepSeekBrowserSession(candidate, token) };
          }
          if (lastValidation.valid) return candidate;
        } catch {}
      }
      return null;
    };
    const finish = (authenticatedPage) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poller);
      context.off("response", handler);
      context.off("close", onClosed);
      setTimeout(() => resolve(authenticatedPage), settleMs);
    };
    const onClosed = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poller);
      context.off("response", handler);
      context.off("close", onClosed);
      reject(new Error("Окно входа DeepSeek закрыто до завершения авторизации."));
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      clearInterval(poller);
      context.off("response", handler);
      context.off("close", onClosed);
      reject(
        Object.assign(new Error(
          `Login timed out after ${Math.round(timeoutMs / 1000)}s. Залогинься в открывшемся окне DeepSeek и подожди — окно закроется автоматически.`,
        ), { code: 'DEEPSEEK_LOGIN_TIMEOUT', userMessage: 'Вход в DeepSeek не подтверждён за отведённое время. Повторите подключение и завершите вход в окне браузера.' }),
      );
    }, timeoutMs);

    const handler = async (response) => {
      if (done) return;
      try {
        const url = response.url();
        if (!url.includes("/api/v0/")) return;
        void checkSession();
      } catch {}
    };

    context.on("response", handler);
    context.on("close", onClosed);
    const checkSession = async () => {
      if (done || checking) return;
      checking = true;
      try {
        const pages = typeof context.pages === "function" ? context.pages() : null;
        if (pages?.length === 0) {
          if (!emptyPagesSince) emptyPagesSince = Date.now();
          if (Date.now() - emptyPagesSince >= emptyPagesGraceMs) onClosed();
          return;
        }
        emptyPagesSince = 0;
        const activePage = await authenticatedDeepSeekPage();
        if (!activePage) return;
        await onAuthenticated?.(activePage);
        finish(activePage);
      } catch {
        // Навигация могла очистить токен между проверкой и снимком; ждём дальше.
      } finally {
        checking = false;
      }
    };
    const poller = setInterval(checkSession, pollMs);
    void checkSession();
  });
}

export async function validateDeepSeekBrowserSession(page, token) {
  try {
    return await page.evaluate(async (userToken) => {
      const response = await fetch("/api/v0/users/current", {
        headers: { Authorization: `Bearer ${userToken}` },
        credentials: "include",
      });
      if (!response.ok) return false;
      const body = await response.json();
      return body?.code === 0;
    }, token);
  } catch {
    return false;
  }
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
  const featureTokens = await captureDeepSeekFeatureTokens(page);
  if (!token) {
    throw new Error("Сессия DeepSeek ещё не подтверждена: userToken не найден. Окно входа останется открытым для повторной проверки.");
  }
  return { cookies, userToken: rawToken, token, ...featureTokens };
}

export async function captureDeepSeekFeatureTokens(page) {
  const raw = await page
    .evaluate(() => {
      const read = (key) => {
        try { return localStorage.getItem(key); } catch { return ""; }
      };
      return {
        hifLeim: read("hif_leim_cached"),
        hifDliq: read("hif_dliq_cached"),
      };
    })
    .catch(() => ({ hifLeim: "", hifDliq: "" }));
  return {
    hifLeim: normalizeToken(raw.hifLeim || ""),
    hifDliq: normalizeToken(raw.hifDliq || ""),
  };
}

export async function refreshDeepSeekFeatureTokensFromProfile(authFile = DEFAULT_AUTH_FILE, options = {}) {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(authFile, "utf8"));
  } catch {}
  const session = await launchCamoufoxSession(deepSeekCamoufoxOptions(true, options));
  const { context } = session;
  try {
    const page = session.page;
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page
      .waitForFunction(() => {
        try { return Boolean(localStorage.getItem("hif_leim_cached")); } catch { return false; }
      }, { timeout: 10_000 })
      .catch(() => {});
    const featureTokens = await captureDeepSeekFeatureTokens(page);
    if (!featureTokens.hifLeim) {
      throw new Error("DeepSeek profile did not expose hif_leim_cached");
    }
    if (authFile && fs.existsSync(authFile)) {
      const next = { ...saved, ...featureTokens, savedAt: new Date().toISOString() };
      fs.writeFileSync(authFile, JSON.stringify(next, null, 2), { mode: 0o600 });
      try { fs.chmodSync(authFile, 0o600); } catch {}
    }
    return featureTokens;
  } finally {
    await session.close();
  }
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
export async function refreshAuthFromProfile(authFile, options = {}) {
  const session = await launchCamoufoxSession(deepSeekCamoufoxOptions(true, options));
  const { context } = session;
  try {
    const page = session.page;
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    return await collectAuthFromContext(context, page, authFile, options.profileDir || options.storageStatePath || DEEPSEEK_STORAGE_STATE);
  } finally {
    await session.close();
  }
}

async function collectAuthFromContext(context, page, authFile, profileDir) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  const cookies = await context.cookies(BASE_URL);
  const userToken = await page.evaluate(() => localStorage.getItem("userToken")).catch(() => "");
  const token = normalizeToken(userToken);

  if (!token) {
    throw new Error("Could not read localStorage userToken. Make sure you are logged in.");
  }
  if (!await validateDeepSeekBrowserSession(page, token)) {
    throw new Error("DeepSeek rejected the saved browser session; visible login is required.");
  }

  const featureTokens = await captureDeepSeekFeatureTokens(page);
  writeSavedAuth(authFile, { cookies, userToken, profileDir, ...featureTokens });
  return {
    token,
    cookieHeader: cookieHeaderFromArray(cookies, { requireSession: false }),
    ...featureTokens,
    source: authFile,
  };
}

// При переподключении удаляем только устаревшую сессию. WAF clearance cookie
// DeepSeek нужна для прохождения проверки в том же браузерном профиле.
export async function clearDeepSeekSessionCookies(context) {
  await context.clearCookies({ domain: /(^|\.)deepseek\.com$/, name: /^ds_session_id$/ });
}

// localStorage НЕ трогаем — это ломало персистентный профиль раньше.
export async function clearProfileSession(options = {}) {
  const session = await launchCamoufoxSession(deepSeekCamoufoxOptions(true, options));
  try {
    await clearDeepSeekSessionCookies(session.context);
  } finally {
    await session.close();
  }
}
