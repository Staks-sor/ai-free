// Login flow для chat.qwen.ai через Playwright.
//
// АЛЬТЕРНАТИВА: если Playwright блокируется антиботом Alibaba (а это бывает),
// используй importQwenFromJson(path) — он принимает JSON-файл cookies, экспортированный
// расширением Chrome (типа "Cookie Editor" или "EditThisCookie"), и сохраняет
// их в qwen-auth.json без Playwright.
//
// Алгоритм:
// 1. Поднимаем persistent Chromium с СОБСТВЕННЫМ профилем (QWEN_BROWSER_PROFILE) —
//    чтобы Google-сессии Qwen не смешивались с DeepSeek.
// 2. Открываем chat.qwen.ai.
// 3. Юзер логинится сам (Google OAuth / email-пароль).
// 4. Ждём, пока в cookies появится `token` (JWT). Это и есть финальный сигнал логина.
// 5. Сохраняем cookies + token в qwen-auth.json.
//
// В отличие от DeepSeek у нас здесь НЕТ:
// - PoW WASM-loader'a
// - Сетевого "Authorization Bearer" detection (можно добавить позже)
// - Сложного авто-заполнения формы (не делаем до сбора фидбэка)

import fs from "node:fs";
import path from "node:path";
import { launchPersistentDeepSeekContext } from "../../browser/launch.mjs";
import {
  QWEN_AUTH_FILE,
  QWEN_BASE_URL,
  QWEN_BROWSER_PROFILE,
  QWEN_REQUIRED_COOKIES,
  QWEN_TOKEN_COOKIE_NAME,
} from "./config.mjs";
import {
  applyQwenCookiesToContext,
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

// Полный сброс Chromium-профиля перед логин-окном (инцидент 2026-09-29:
// в профиле жила старая сессия refresh_token → JWT детектился мгновенно,
// окно схлопывалось, в пул летел СТАРЫЙ аккаунт вместо нового). Каждый
// логин должен начинаться с чистой разлогиненной сессии.
// БЕЗОПАСНОСТЬ: удаляем только если каталог похож на Chromium-профиль
// (есть "Default"/ subdir и/или "Local State"), иначе отказ.
export function wipeBrowserProfileDir(profileDir) {
  try {
    if (!profileDir || typeof profileDir !== "string") return { wiped: false, reason: "empty path" };
    if (!fs.existsSync(profileDir)) return { wiped: false, reason: "not exists" };
    const entries = fs.readdirSync(profileDir);
    if (entries.length === 0) return { wiped: false, reason: "already empty" };
    const looksLikeChromium = entries.includes("Local State") || entries.includes("Default");
    if (!looksLikeChromium) return { wiped: false, reason: "not a chromium profile" };
    fs.rmSync(profileDir, { recursive: true, force: true });
    return { wiped: true };
  } catch (error) {
    return { wiped: false, reason: error.message };
  }
}

// Главный entry-point для `npm run login-qwen` и in-app re-login.
// options.profileDir — собственный persistent-профиль аккаунта (мультиаккаунт);
// без него используется дефолтный QWEN_BROWSER_PROFILE.
export async function loginQwenAndSave(authFile = QWEN_AUTH_FILE, { clearSession = false, profileDir = null, headless = false, onLoginWindowOpen = null } = {}) {
  const effectiveProfileDir = profileDir || QWEN_BROWSER_PROFILE;
  const previousToken = clearSession ? (readQwenAuth(authFile)?.token || "") : "";
  // Полный сброс профиля: логин-окно ВСЕГДА стартует с чистой разлогиненной
  // сессии. Иначе старый refresh_token в профиле даёт мгновенный JWT-детект,
  // окно схлопывается, в пул летит предыдущий аккаунт (инцидент 2026-09-29).
  // Для дефолтного профиля «первый логин» — то же самое: чистый старт.
  const wipe = wipeBrowserProfileDir(effectiveProfileDir);
  if (wipe.wiped) console.log(`🧹 Профиль сброшен (${path.basename(effectiveProfileDir)}) — чистая сессия для нового логина.`);
  else if (wipe.reason && wipe.reason !== "not exists" && wipe.reason !== "already empty") {
    console.warn(`⚠️ Профиль не сброшен: ${wipe.reason}`);
  }
  const { getChatGPTChromium } = await import("../chatgpt/engine.mjs");
  const chromium = await getChatGPTChromium();
  // Переиспользуем launch-функцию от DeepSeek — она запускает реальный Chrome.
  // headless=true — для автологина (QWEN_AUTOLOGIN_HEADLESS=0 — показать окно).
  const context = await launchPersistentDeepSeekContext(chromium, effectiveProfileDir, headless);

  // F12-Network жучок логин-браузера: от старта окна до JWT-токена.
  // QWEN_TELEMETRY=1 или QWEN_LOGIN_TELEMETRY=1. Полный след: все
  // запросы/ответы, навигации (вход/OAuth/punish), антибот, плашка лимита.
  const { shouldCaptureLoginTelemetry, createTelemetryRecorder } = await import("./telemetry-recorder.mjs");
  const loginTelemetry = shouldCaptureLoginTelemetry()
    ? createTelemetryRecorder({
        root: process.env.QWEN_TELEMETRY_DIR || "telemetry",
        label: `login-${path.basename(effectiveProfileDir)}`,
      })
    : null;
  if (loginTelemetry) {
    console.warn(`[qwen-login] telemetry ON (full capture) -> ${loginTelemetry.dir}`);
    loginTelemetry.attachToContext(context, { capture: "full" });
    loginTelemetry.record("login_window_opened", { profile: path.basename(effectiveProfileDir) });
  }
  try {
  return await loginQwenAndSaveInner(context, authFile, {
    clearSession,
    profileDir: effectiveProfileDir,
    previousToken,
    loginTelemetry,
    onLoginWindowOpen,
  });
  } finally {
    loginTelemetry?.record("login_window_closed", {});
    await loginTelemetry?.close().catch?.(() => {});
  }
}

async function loginQwenAndSaveInner(context, authFile, { clearSession, profileDir, previousToken, loginTelemetry, onLoginWindowOpen = null }) {

  // Стелс-меры против антибота Alibaba. Маскируем самые палевные follow-up
  // признаки автоматизации — navigator.webdriver, plugins, permissions API.
  // Делаем ДО первой навигации, чтобы их JS никогда не увидел "true" значения.
  await context.addInitScript(() => {
    // 1. Главный палевный флаг — webdriver. Скрываем через property descriptor.
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });

    // 2. У автоматизированных браузеров navigator.plugins обычно пустой массив.
    // Подделываем "нормальный" список с одним PDF Viewer.
    Object.defineProperty(navigator, "plugins", {
      get: () => [
        { name: "PDF Viewer", filename: "internal-pdf-viewer", description: "" },
        { name: "Chrome PDF Viewer", filename: "internal-pdf-viewer", description: "" },
      ],
    });

    // 3. languages — Playwright-Chromium иногда выставляет в один элемент. Делаем "ru-RU,ru,en".
    Object.defineProperty(navigator, "languages", { get: () => ["ru-RU", "ru", "en"] });

    // 4. window.chrome — в обычном Chrome есть, антибот может проверять.
    if (!window.chrome) {
      window.chrome = { runtime: {} };
    }
  });

  const page = context.pages()[0] || (await context.newPage());
  loginTelemetry?.attachToPage(page, "login", { capture: "full" });

  // Снимок куков ДО логина: видно, какие записи остались от прошлой сессии
  try {
    const cookiesBefore = await context.cookies(QWEN_BASE_URL);
    loginTelemetry?.record("cookies_snapshot", {
      phase: "before_login",
      names: cookiesBefore.map((c) => c.name),
    });
  } catch {}

  if (clearSession) {
    console.log("🔒 Сбрасываю старую сессию Qwen в профиле — нужен новый вход.");
    loginTelemetry?.record("session_cleared", {});
    await context.clearCookies();
    await page.evaluate(() => {
      try { localStorage.removeItem("token"); } catch {}
    });
  }

  await page.goto(QWEN_BASE_URL, { waitUntil: "domcontentloaded" });

  console.log("🔓 Qwen login window открыто (chat.qwen.ai).");
  console.log("   • Залогинься любым способом (Google OAuth, email/пароль).");
  console.log("   • НИЧЕГО нажимать в терминале не нужно.");
  if (clearSession) {
    console.log("   • Окно не закроется, пока не завершишь вход заново (старый токен сброшен).");
  } else {
    console.log("   • Окно закроется автоматически, когда появится JWT-токен.");
  }

  let captured;
  try {
    // Автологин: скрипт логина крутится ПАРАЛЛЕЛЬНО с ожиданием JWT —
    // waitForQwenToken ловит токен в момент, когда SPA его положит.
    // Скрипт упал раньше токена → fail fast с его ошибкой (без 15-мин ожидания).
    const waitPromise = waitForQwenToken(context, { previousToken, page });
    if (typeof onLoginWindowOpen === "function") {
      const scriptPromise = onLoginWindowOpen(page);
      captured = await new Promise((resolve, reject) => {
        waitPromise.then(resolve, reject);
        scriptPromise.catch(reject);
      });
    } else {
      captured = await waitPromise;
    }
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
  // JWT пойман — финальный снапшот куков имена+домены (значения секретны)
  loginTelemetry?.record("login_success", {
    userId: captured.userId,
    cookieNames: captured.cookies.map((c) => c.name),
  });

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
  }, captured.token);

  writeQwenAuth(authFile, {
    cookies: captured.cookies,
    token: captured.token,
    userId: captured.userId,
    profileDir,
  });
  await context.close();

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

// Детект JWT: Qwen 29.09 перестал гарантированно класть token в cookies —
// после переделки на кредиты токен часто живёт ТОЛЬКО в localStorage.
// Инцидент 2026-09-29: юзер залогинился и общался в окне, а детект крутил
// куки → 300s timeout → context.close() убил браузер прямо в переписке.
export function findQwenJwt({ cookies, storageToken, previousToken = "" } = {}) {
  const isJwt = (v) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(v || ""));
  const cookieToken = cookies?.find((c) => c.name === QWEN_TOKEN_COOKIE_NAME)?.value || "";
  const byCookie = isJwt(cookieToken) ? cookieToken : "";
  const byStorage = isJwt(storageToken) ? storageToken : "";
  const token = byStorage || byCookie;
  if (!token) return null;
  if (previousToken && token === previousToken) return null;
  const userId =
    cookies?.find((c) => c.name === "cnaui")?.value ||
    cookies?.find((c) => c.name === "aui")?.value ||
    "";
  return { token, source: byStorage ? "localStorage" : "cookies", userId };
}

// Ждём появления валидного JWT в куках ИЛИ localStorage.
// previousToken — при re-login не принимаем тот же JWT, что был до сброса.
async function waitForQwenToken(
  context,
  { timeoutMs = 15 * 60 * 1000, intervalMs = 1000, previousToken = "", page = null, onProgress = null } = {},
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

    // токен может жить в localStorage (инцидент 2026-09-29)
    let storageToken = null;
    try {
      storageToken = await page.evaluate(() => {
        try { return (function(){var r=null;try{r=localStorage.getItem("qwen_access_token_state")}catch(e){}if(r){try{var p=JSON.parse(r);if(p&&typeof p.token==="string"&&p.token)return p.token}catch(e){}}try{return localStorage.getItem("token")||null}catch(e){return null}})() || null; } catch { return null; }
      });
    } catch {}

    const found = findQwenJwt({ cookies, storageToken, previousToken });
    if (found) return { cookies, token: found.token, userId: found.userId, source: found.source };

    if (storageToken && storageToken !== lastSeen) {
      lastSeen = storageToken;
      console.log(`[qwen-login] token in localStorage (${storageToken.length} chars) — checking format...`);
    }

    if (onProgress) {
      try { onProgress({ elapsedMs: Date.now() - startedAt, timeoutMs }); } catch {}
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Qwen login timeout (${Math.round(timeoutMs / 1000)}s). Не дождались валидного JWT в куках/localStorage. Попробуй снова.`,
  );
}

// Считать JWT и куки из уже открытого контекста (после goto на chat.qwen.ai).
// 2026-09-29: токен живёт в localStorage (1-часовой access-JWT), куки token
// больше нет. Ждём пока SPA сам сделает refresh (его fetch идёт с правильным
// фингерпринтом) и положит свежий JWT в localStorage — обычно 2-6 секунд.
async function captureQwenAuthFromContext(context, authFile, profileDir, { waitMs = 20_000, page = null } = {}) {
  const cookies = await context.cookies(QWEN_BASE_URL);
  const startedAt = Date.now();
  let storageToken = null;
  while (Date.now() - startedAt < waitMs) {
    try {
      storageToken = await page.evaluate(() => {
        try { return (function(){var r=null;try{r=localStorage.getItem("qwen_access_token_state")}catch(e){}if(r){try{var p=JSON.parse(r);if(p&&typeof p.token==="string"&&p.token)return p.token}catch(e){}}try{return localStorage.getItem("token")||null}catch(e){return null}})() || null; } catch { return null; }
      });
    } catch {}
    const found = findQwenJwt({ cookies, storageToken });
    if (found) {
      writeQwenAuth(authFile, { cookies, token: found.token, userId: found.userId, profileDir });
      return {
        token: found.token,
        userId: found.userId,
        cookieHeader: qwenCookieHeaderFromArray(cookies),
        cookies,
        source: authFile,
      };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    "Не дождались JWT после загрузки chat.qwen.ai (SPA не сделал refresh за " +
      Math.round(waitMs / 1000) + "s). Возможно, сессия профиля умерла — нужен логин: npm run login-qwen",
  );
}
// Тихий refresh для pool-аккаунта. ПРИОРИТЕТ 1 (2026-09-29, инцидент с убитыми
// профилями): через УЖЕ ОТКРЫТЫЙ browser-proxy этого аккаунта — reloadForAuth()
// перезагружает page0, SPA сам делает auth.qwen.ai/api/v2/auths/refresh и
// кладёт свежий JWT в localStorage. Второй Chromium на том же профиле НЕ
// открываем: прокси уже держит профиль, дубль перезаписывает cookie-базу
// (last-writer-wins сносит refresh_token — так умерли 5 профилей 29.09).
// ПРИОРИТЕТ 2 (fallback): отдельный headless Chromium, только если прокси
// этого аккаунта не запущен.
export async function refreshQwenAccountAuthFromProfile(accountId) {
  // 1) Живой прокси уже открыл профиль — просим его перезагрузиться и
  //    ДОЖДАТЬСЯ свежий JWT (см. reloadForAuth: ждёт exp > previous + 30s).
  //    Инцидент 2026-09-30: при таймауте 12s fallback уходил в ветку 2 и
  //    открывал ВТОРОЙ Chromium на живом профиле (убийца cookie-баз из
  //    29.09). Теперь ветка 1 живёт дольше (25s) и падает честной ошибкой,
  //    если SPA так и не обновился.
  try {
    const proxyModule = await import("./browser-proxy.mjs");
    const { getAccountAnyStatus } = await import("./account-store.mjs");
    const account = getAccountAnyStatus(accountId);
    const proxy = await proxyModule.getQwenBrowserProxy({ accountId }).catch(() => null);
    if (proxy?.reloadForAuth) {
      const token = await proxy.reloadForAuth({ previousToken: account?.token || null, waitMs: 25_000 });
      const { qwenJwtExp } = await import("./browser-proxy.mjs");
      if (token && qwenJwtExp(token) > Date.now() / 1000 + 30) {
        const { updateAccountFromProfile } = await import("./account-store.mjs");
        const { slotSyncPayload } = await import("./browser-proxy.mjs");
        // атомарно: токен + свежие куки прокси-контекста (полусвежий слот — бомба)
        let cookies = [];
        if (proxy.exportSessionSnapshot) {
          const snap = await proxy.exportSessionSnapshot().catch(() => null);
          if (snap?.token) cookies = snap.cookies || [];
        }
        updateAccountFromProfile(accountId, slotSyncPayload({ snapshot: { token, cookies }, token }));
        return { token, cookies, userId: "" };
      }
      // Прокси жив, но SPA не обновился — НЕ открываем второй браузер на
      // живом профиле; отдаём ошибку ротации, аккаунт проверит health-check.
      throw new Error("живой прокси не выдал свежий JWT за 25s — нужна проверка/ре-логин, второй Chromium не открываем");
    }
  } catch (err) {
    if (String(err?.message || '').includes('не выдал свежий JWT')) throw err;
  }
  // 2) Прокси нет — открываем профиль сами (одиночный случай: CLI/меню).
  const { getAccountAnyStatus, updateAccountFromProfile, getAccountProfileDir } = await import("./account-store.mjs");
  const account = getAccountAnyStatus(accountId);
  if (!account) throw new Error(`account not found: ${accountId}`);
  const profileDir = account.profileDir || getAccountProfileDir(accountId);
  if (!fs.existsSync(profileDir)) {
    throw new Error(`profile not found: ${profileDir}`);
  }
  const { getChatGPTChromium } = await import("../chatgpt/engine.mjs");
  const chromium = await getChatGPTChromium();
  const context = await launchPersistentDeepSeekContext(chromium, profileDir, true);
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(QWEN_BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const startedAt = Date.now();
    const { qwenJwtExp } = await import("./browser-proxy.mjs");
    while (Date.now() - startedAt < 20_000) {
      const cookies = await context.cookies(QWEN_BASE_URL);
      let storageToken = null;
      try {
        storageToken = await page.evaluate(() => {
          try { return (function(){var r=null;try{r=localStorage.getItem("qwen_access_token_state")}catch(e){}if(r){try{var p=JSON.parse(r);if(p&&typeof p.token==="string"&&p.token)return p.token}catch(e){}}try{return localStorage.getItem("token")||null}catch(e){return null}})() || null; } catch { return null; }
        });
      } catch {}
      const found = findQwenJwt({ cookies, storageToken, previousToken: account.token });
      // Тот же анти-самообман: только токен живее 30s считается обновлением.
      if (found && qwenJwtExp(found.token) > Date.now() / 1000 + 30) {
        updateAccountFromProfile(accountId, { token: found.token, cookies });
        return { token: found.token, cookies, userId: found.userId };
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("SPA не сделал refresh за 20s — сессия профиля умерла, нужен re-login");
  } finally {
    await context.close().catch(() => {});
  }
}

// Тихий refresh: headless Chromium с тем же профилем, что при login-qwen.
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

  const { getChatGPTChromium } = await import("../chatgpt/engine.mjs");
  const chromium = await getChatGPTChromium();
  const context = await launchPersistentDeepSeekContext(chromium, profileDir, true);
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(QWEN_BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);
    // SPA сам дёрнет auth.qwen.ai/api/v2/auths/refresh со своим фингерпринтом
    // и положит свежий 1-часовой JWT в localStorage — ждём и забираем.
    return await captureQwenAuthFromContext(context, authFile, profileDir, { page });
  } finally {
    await context.close().catch(() => {});
  }
}

// Записать импортированные/обновлённые куки в persistent-профиль для browser-proxy.
export async function syncQwenCookiesToProfile(cookies, profileDir = QWEN_BROWSER_PROFILE) {
  const { getChatGPTChromium } = await import("../chatgpt/engine.mjs");
  const chromium = await getChatGPTChromium();
  const context = await launchPersistentDeepSeekContext(chromium, profileDir, true);
  try {
    await applyQwenCookiesToContext(context, cookies);
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(QWEN_BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1500);
  } finally {
    await context.close().catch(() => {});
  }
}
