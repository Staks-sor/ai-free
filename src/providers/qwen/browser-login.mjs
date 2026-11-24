// Login flow для chat.qwen.ai через Camoufox.
//
// АЛЬТЕРНАТИВА: если браузер блокируется антиботом Alibaba,
// используй importQwenFromJson(path) — он принимает JSON-файл cookies, экспортированный
// расширением Chrome (типа "Cookie Editor" или "EditThisCookie"), и сохраняет
// их в qwen-auth.json без Playwright.
//
// Алгоритм:
// 1. Поднимаем Camoufox с отдельным состоянием аккаунта (QWEN_BROWSER_PROFILE) —
//    чтобы Google-сессии Qwen не смешивались с DeepSeek.
// 2. Открываем chat.qwen.ai.
// 3. Юзер логинится сам (Google OAuth / email-пароль).
// 4. Ждём свежий `token` (JWT) в Qwen localStorage или cookies.
// 5. Сохраняем cookies + token в qwen-auth.json.
//
// В отличие от DeepSeek у нас здесь НЕТ:
// - PoW WASM-loader'a
// - Сетевого "Authorization Bearer" detection (можно добавить позже)
// - Сложного авто-заполнения формы (не делаем до сбора фидбэка)

import fs from "node:fs";
import { launchQwenCamoufoxSession } from "./camoufox-session.mjs";
import {
  QWEN_AUTH_FILE,
  QWEN_BASE_URL,
  QWEN_BROWSER_PROFILE,
  QWEN_REQUIRED_COOKIES,
  QWEN_TOKEN_COOKIE_NAME,
} from "./config.mjs";
import {
  applyQwenCookiesToContext,
  seedQwenPageToken,
  qwenCookieHeaderFromArray,
  readQwenAuth,
  writeQwenAuth,
} from "./auth-files.mjs";

// Импорт куки из JSON-файла, экспортированного из обычного Chrome
// (расширения "Cookie Editor", "EditThisCookie", и т.п.).
// Формат: массив объектов с полями name, value, domain, path, ...
//
// Это РАБОЧИЙ обходной путь, когда Playwright блокируется антиботом chat.qwen.ai.
// Юзер сам логинится в своём обычном Chrome → экспортит куки → мы импортим.
export async function importQwenFromJson(jsonPath, authFile = QWEN_AUTH_FILE) {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Файл не найден: ${jsonPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch (error) {
    throw new Error(`Не валидный JSON в ${jsonPath}: ${error.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Ожидался массив cookies, получено: ${typeof parsed}`);
  }

  // Фильтруем только куки для qwen.ai (на случай если файл содержит и другие домены).
  const qwenCookies = parsed.filter((c) => {
    const d = String(c?.domain || "");
    return d.includes("qwen.ai");
  });

  if (qwenCookies.length === 0) {
    throw new Error(`В файле нет cookies для qwen.ai. Проверь экспорт.`);
  }

  // Ищем критичный token.
  const tokenCookie = qwenCookies.find((c) => c.name === QWEN_TOKEN_COOKIE_NAME);
  if (!tokenCookie?.value) {
    throw new Error(
      `В файле нет cookie "${QWEN_TOKEN_COOKIE_NAME}" — без него API Qwen не работает.\n` +
        `Залогинься в chat.qwen.ai, потом снова экспортируй cookies.`,
    );
  }

  const looksLikeJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(tokenCookie.value);
  if (!looksLikeJwt) {
    console.warn(
      `⚠️ token не выглядит как JWT (3 части через точку). Возможно файл устарел или повреждён.`,
    );
  }

  // Приводим к Playwright-формату на всякий случай (некоторые экспортеры дают разный shape).
  const normalized = qwenCookies.map((c) => ({
    name: String(c.name),
    value: String(c.value),
    domain: String(c.domain),
    path: c.path || "/",
    httpOnly: Boolean(c.httpOnly),
    secure: Boolean(c.secure),
    sameSite: c.sameSite || "Lax",
    expires: typeof c.expirationDate === "number" ? Math.floor(c.expirationDate) : -1,
  }));

  const userId =
    qwenCookies.find((c) => c.name === "cnaui")?.value ||
    qwenCookies.find((c) => c.name === "aui")?.value ||
    "";

  const profileDir = QWEN_BROWSER_PROFILE;
  writeQwenAuth(authFile, {
    cookies: normalized,
    token: tokenCookie.value,
    userId,
    profileDir,
  });

  // Синхронизируем куки в persistent-профиль — иначе browser-proxy не увидит сессию.
  try {
    await syncQwenCookiesToProfile(normalized, profileDir);
    console.log(`🔄 Cookies synced to browser profile (${profileDir})`);
  } catch (error) {
    console.warn(`⚠️ Could not sync cookies to profile: ${error.message}`);
    console.warn("   API через browser-transport может не работать до npm run login-qwen.");
  }

  console.log(`✅ Imported ${normalized.length} Qwen cookies (token: ${tokenCookie.value.slice(0, 24)}...)`);
  console.log(`💾 Saved to ${authFile}`);
  if (userId) console.log(`👤 user_id = ${userId}`);
  return { token: tokenCookie.value, userId, cookies: normalized };
}

// Главный entry-point для `npm run login-qwen` и in-app re-login.
// options.profileDir — каталог состояния аккаунта (мультиаккаунт);
// без него используется дефолтный QWEN_BROWSER_PROFILE.
export async function loginQwenAndSave(authFile = QWEN_AUTH_FILE, { clearSession = false, profileDir = null, onProgress } = {}) {
  const effectiveProfileDir = profileDir || QWEN_BROWSER_PROFILE;
  const previousToken = readQwenAuth(authFile)?.token || "";
  const session = await launchQwenCamoufoxSession(effectiveProfileDir, false);
  const context = session.context;
  const page = session.page;
  let captured;

  try {
    if (clearSession) {
      console.log("🔒 Сбрасываю старую сессию Qwen в профиле — нужен новый вход.");
      await clearQwenSessionCookies(context);
      await page.evaluate(() => {
        try { localStorage.removeItem("token"); } catch {}
      });
    }

    await page.goto(QWEN_BASE_URL, { waitUntil: "domcontentloaded" });
    await page.bringToFront();

    console.log("🔓 Qwen login window открыто (chat.qwen.ai).");
    console.log("   • Залогинься любым способом (Google OAuth, email/пароль).");
    console.log("   • НИЧЕГО нажимать в терминале не нужно.");
    if (clearSession) {
      console.log("   • Окно не закроется, пока не завершишь вход заново (старый токен сброшен).");
    } else {
      console.log("   • Окно закроется автоматически, когда появится JWT-токен.");
    }

    captured = await waitForQwenToken(context, { page, previousToken: clearSession ? previousToken : "" });
    await alignQwenAuthInContext(context, captured);

    writeQwenAuth(authFile, {
      cookies: captured.cookies,
      token: captured.token,
      userId: captured.userId,
      profileDir: effectiveProfileDir,
    });

    onProgress?.({ phase: 'closing', message: 'Данные входа Qwen сохранены. Завершаем закрытие браузера…' });
  } finally {
    await session.close();
  }
  console.log("✅ Qwen login successful.");
  console.log(`💾 Saved auth to ${authFile}`);
  return {
    token: captured.token,
    userId: captured.userId,
    cookieHeader: qwenCookieHeaderFromArray(captured.cookies),
    cookies: captured.cookies,
    source: authFile,
  };
}

export async function clearQwenSessionCookies(context) {
  await context.clearCookies({ domain: /(^|\.)qwen\.ai$/ });
}

function isUnexpiredQwenJwt(token) {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return false;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return !Number.isFinite(payload.exp) || payload.exp * 1000 > Date.now() + 30_000;
  } catch {
    return true; // Leave provider validation to Qwen for nonstandard JWT payloads.
  }
}

async function qwenTokenCandidates(context, page, cookies) {
  const tokens = [];
  const pages = [...new Set([page, ...(context.pages?.() || [])].filter(Boolean))];
  for (const candidate of pages) {
    let url;
    try { url = candidate.url?.(); } catch { continue; }
    if (url) {
      try {
        const hostname = new URL(url).hostname;
        if (hostname !== 'qwen.ai' && !hostname.endsWith('.qwen.ai')) continue;
      } catch { continue; }
    }
    const token = await candidate.evaluate(() => localStorage.getItem('token') || '').catch(() => '');
    if (token) tokens.push(token);
  }
  const cookieToken = cookies.find(cookie => cookie.name === QWEN_TOKEN_COOKIE_NAME)?.value;
  if (cookieToken) tokens.push(cookieToken);
  return [...new Set(tokens)];
}

function cookiesWithQwenToken(cookies, token) {
  const saved = cookies.map(cookie => cookie.name === QWEN_TOKEN_COOKIE_NAME ? { ...cookie, value: token } : cookie);
  if (!saved.some(cookie => cookie.name === QWEN_TOKEN_COOKIE_NAME)) {
    saved.push({ name: QWEN_TOKEN_COOKIE_NAME, value: token, domain: '.qwen.ai', path: '/', secure: true, httpOnly: false, sameSite: 'Lax', expires: -1 });
  }
  return saved;
}

export async function alignQwenAuthInContext(context, { token, cookies }) {
  await applyQwenCookiesToContext(context, cookiesWithQwenToken(cookies, token));
  let synced = false;
  for (const page of context.pages()) {
    let hostname;
    try { hostname = new URL(page.url()).hostname; } catch { continue; }
    if (hostname !== 'qwen.ai' && !hostname.endsWith('.qwen.ai')) continue;
    try {
      await page.evaluate(value => localStorage.setItem('token', value), token);
      synced = true;
    } catch { /* A Qwen tab may navigate while OAuth completes. */ }
  }
  if (!synced) throw new Error('Qwen login token was not saved in the browser profile.');
}

// Ждём валидный JWT в `token` текущей Qwen-вкладки или cookies.
// previousToken — при re-login не принимаем тот же JWT, что был до сброса сессии.
export async function waitForQwenToken(
  context,
  { page = null, timeoutMs = 5 * 60 * 1000, intervalMs = 1000, previousToken = "" } = {},
) {
  const startedAt = Date.now();
  let lastSeen = "";
  let staleTokenLogged = false;
  while (Date.now() - startedAt < timeoutMs) {
    let cookies;
    try {
      cookies = await context.cookies(QWEN_BASE_URL);
    } catch {
      throw new Error("Qwen login window was closed before authentication completed.");
    }

    const candidates = await qwenTokenCandidates(context, page, cookies);
    for (const token of candidates) {
      const hasRequiredAuth = QWEN_REQUIRED_COOKIES.every((name) => name === QWEN_TOKEN_COOKIE_NAME
        ? Boolean(token) : cookies.some((cookie) => cookie.name === name));
      if (hasRequiredAuth && isUnexpiredQwenJwt(token) && token !== previousToken) {
        const userId = cookies.find((c) => c.name === "cnaui")?.value
          || cookies.find((c) => c.name === "aui")?.value
          || "";
        return { cookies: cookiesWithQwenToken(cookies, token), token, userId };
      }
      if (previousToken && token === previousToken && !staleTokenLogged) {
        staleTokenLogged = true;
        console.log("[qwen-login] Старый JWT ещё в профиле — заверши вход заново в окне браузера…");
      }
      if (token && token !== lastSeen) {
        lastSeen = token;
        console.log(`[qwen-login] token found (${token.length} chars) — checking format...`);
      }
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Qwen login timeout (${Math.round(timeoutMs / 1000)}s). Не дождались валидного JWT в браузерной сессии. Попробуй снова.`,
  );
}

// Считать JWT и куки из уже открытого контекста (после goto на chat.qwen.ai).
async function captureQwenAuthFromContext(context, page, authFile, profileDir) {
  const cookies = await context.cookies(QWEN_BASE_URL);
  const token = (await qwenTokenCandidates(context, page, cookies)).find(isUnexpiredQwenJwt) || '';
  const looksLikeJwt = Boolean(token);

  if (!looksLikeJwt) {
    throw new Error(
      "В профиле Qwen нет валидного JWT (cookie token). Залогинься: npm run login-qwen",
    );
  }

  const userId =
    cookies.find((c) => c.name === "cnaui")?.value ||
    cookies.find((c) => c.name === "aui")?.value ||
    "";

  const alignedCookies = cookiesWithQwenToken(cookies, token);
  await alignQwenAuthInContext(context, { token, cookies: alignedCookies });
  writeQwenAuth(authFile, { cookies: alignedCookies, token, userId, profileDir });
  return {
    token,
    userId,
    cookieHeader: qwenCookieHeaderFromArray(alignedCookies),
    cookies: alignedCookies,
    source: authFile,
  };
}

// Тихий refresh: Camoufox с тем же состоянием аккаунта, что при login-qwen.
// Если Google-сессия в профиле жива — обновляем auth.json без окна.
export async function refreshQwenAuthFromProfile(authFile = QWEN_AUTH_FILE) {
  if (!fs.existsSync(authFile)) {
    throw new Error(`Qwen auth file not found: ${authFile}`);
  }

  let profileDir = QWEN_BROWSER_PROFILE;
  try {
    const saved = JSON.parse(fs.readFileSync(authFile, "utf8"));
    if (saved?.profileDir) profileDir = saved.profileDir;
  } catch {
    // используем дефолтный профиль
  }

  const session = await launchQwenCamoufoxSession(profileDir, true);
  const context = session.context;
  try {
    const saved = readQwenAuth(authFile);
    if (saved?.cookies?.length) await applyQwenCookiesToContext(context, saved.cookies, { preserveSession: true });
    if (saved?.token) await context.addInitScript(seedQwenPageToken, saved.token);
    const page = session.page;
    await page.goto(QWEN_BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await waitForQwenToken(context, { page, previousToken: saved?.token || "", timeoutMs: 20_000, intervalMs: 500 });
    return await captureQwenAuthFromContext(context, page, authFile, profileDir);
  } catch (error) {
    if (/NS_ERROR_NET|NS_BINDING_ABORTED|net::ERR|page\.goto:[\s\S]*Timeout/i.test(String(error?.message || error))) {
      throw Object.assign(new Error('Qwen недоступен по сети: не удалось обновить сохранённую сессию. Повторите запрос после восстановления соединения.'), {
        code: 'QWEN_SESSION_REFRESH_UNAVAILABLE', delivery: 'not_sent', cause: error,
      });
    }
    throw error;
  } finally {
    await session.close().catch(() => {});
  }
}

// Записать импортированные/обновлённые куки в состояние Camoufox для browser-proxy.
export async function syncQwenCookiesToProfile(cookies, profileDir = QWEN_BROWSER_PROFILE) {
  const session = await launchQwenCamoufoxSession(profileDir, true);
  const context = session.context;
  try {
    await applyQwenCookiesToContext(context, cookies);
    const page = session.page;
    await page.goto(QWEN_BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1500);
  } finally {
    await session.close().catch(() => {});
  }
}
