// Автологин Qwen-пула: если сессия аккаунта умерла и refresh не спас —
// логинимся сами по email/паролю из logins.txt (формат: `email password`
// в одну строку; # — комментарий). Протокол снят с живого DOM chat.qwen.ai
// 2026-10-02:
//   / → баннер кук (принять) → кнопка «Войти» → /auth:
//   input[name="email"] + «Войти с паролем» → input[name="password"] +
//   кнопка «Войти» → редирект в чат → JWT в localStorage (ловит
//   существующий waitForQwenToken). Baxia-слайдер на логине — редкость,
//   но при появлении дёргаем существующий trySolveBaxiaOnPage.
//
// Человечоподобие: посимвольный ввод с рандомными паузами 60–220мс,
// рандомные паузы между шагами 0.8–2.2с, фокус/blur полей, местами «думает».
// Headless по умолчанию (QWEN_AUTOLOGIN_HEADLESS=0 — показать окно).

import fs from "node:fs";
import path from "node:path";

export const QWEN_LOGINS_FILE = process.env.QWEN_LOGINS_FILE || "logins.txt";

// --- Чистые функции (тестируются) ---

// Парсер logins.txt → Map<email, password>. Пробел — разделитель; всё после
// первого пробела — пароль (внутренние пробелы допустимы). Комментарии #/;,
// пустые строки и строки без пароля игнорируются.
export function parseQwenLoginsFile(text) {
  const map = new Map();
  if (!text) return map;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const spaceIdx = line.indexOf(" ");
    if (spaceIdx === -1) continue;
    const email = line.slice(0, spaceIdx).trim();
    const password = line.slice(spaceIdx + 1).trim();
    if (!email || !password) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    map.set(email, password);
  }
  return map;
}

// Разрешён ли автологин для аккаунта: env-гейт + пароль найден + пул.
export function resolveQwenAutoLogin({ account, logins, enabled }) {
  if (!enabled) return { allowed: false, reason: "disabled" };
  if (!account || account.id === "default") return { allowed: false, reason: "pool only" };
  const label = String(account?.label || "");
  if (!label.includes("@")) return { allowed: false, reason: "label is not an email" };
  const password = logins.get(label);
  if (!password) return { allowed: false, reason: `no password in ${path.basename(QWEN_LOGINS_FILE)} for ${label}` };
  return { allowed: true, password, email: label };
}

// Ключ дедупликации: один автологин-прогон на аккаунт на процесс.
export function autoLoginAttemptKey(accountId) {
  return `autologin:${accountId}`;
}

// --- Рантайм ---

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Человечоподобная пауза между шагами.
async function humanPause(minMs = 800, maxMs = 2200) {
  await sleep(randInt(minMs, maxMs));
}

// Человечоподобный посимвольный ввод в input.
async function humanType(page, selector, text) {
  const el = page.locator(selector).first();
  await el.click({ delay: randInt(40, 120) });
  await sleep(randInt(150, 400));
  for (const ch of text) {
    await el.type(ch, { delay: randInt(60, 220) });
  }
  await sleep(randInt(120, 350));
}

// Найти кнопку по точному/частичному тексту.
// (используем page.locator("button", { hasText }) инлайн в шагах)

// Принять cookie-баннер, если показан.
async function acceptCookieBanner(page) {
  try {
    const btn = page.locator("button", { hasText: "Принять все файлы cookie" }).first();
    await btn.click({ timeout: 2500 });
    await humanPause(400, 900);
  } catch {
    // баннера нет — ок
  }
}

// Загрузить Map логинов из файла (cwd сервера).
export function loadQwenLogins(file = QWEN_LOGINS_FILE) {
  try {
    const text = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
    return parseQwenLoginsFile(text);
  } catch {
    return new Map();
  }
}

const AUTOLOGIN_DONE = new Set();

// Полный автологин аккаунта пула. Возвращает результат loginQwenAndSave.
// Один прогон на аккаунт на процесс (повтор — только через новый процесс).
export async function autoLoginQwenAccount(account, { headless = true, log = console.log } = {}) {
  const key = autoLoginAttemptKey(account.id);
  if (AUTOLOGIN_DONE.has(key)) {
    throw new Error(`autologin already attempted for ${account.id} in this process`);
  }
  AUTOLOGIN_DONE.add(key);

  const logins = loadQwenLogins();
  const decision = resolveQwenAutoLogin({
    account,
    logins,
    enabled: process.env.QWEN_AUTOLOGIN !== "0",
  });
  if (!decision.allowed) {
    throw new Error(`autologin not allowed: ${decision.reason}`);
  }

  const { loginQwenAndSave } = await import("./browser-login.mjs");
  const { getAccountProfileDir } = await import("./account-store.mjs");
  const profileDir = account.profileDir || getAccountProfileDir(account.id);
  const authFile = path.join(profileDir, "auth.json");

  log(`🤖 [autologin] ${account.id} (${decision.email}): старт (headless=${headless ? "да" : "нет"})`);

  // loginQwenAndSave сам вайпает профиль (чистая сессия) и ловит JWT через
  // waitForQwenToken. Нам нужно вклиниться в момент между goto и ожиданием
  // токена — для этого используем переменную-хук: логин-скрипт исполняется
  // колбэком, пока waitForQwenToken крутит свой цикл.
  let loginScriptError = null;
  const result = await loginQwenAndSave(authFile, {
    clearSession: true,
    profileDir,
    onLoginWindowOpen: async (page) => {
      try {
        await performQwenLogin(page, decision.email, decision.password, { log });
      } catch (err) {
        loginScriptError = err;
        throw err;
      }
    },
  }).catch((err) => {
    if (loginScriptError) throw loginScriptError;
    throw err;
  });

  log(`🤖 [autologin] ${account.id}: успех, JWT пойман, слот обновлён`);

  // Слот пула тоже валидируем (иначе health/меню видят старый invalid до
  // первого запроса через хендлер). Атомарно: токен+куки из одного логина.
  try {
    const { markValid } = await import("./account-store.mjs");
    markValid(account.id, {
      token: result.token,
      cookies: result.cookies,
      cookieHeader: result.cookieHeader,
      userId: result.userId,
    });
    log(`🤖 [autologin] ${account.id}: пул-слот валидирован (invalid снят, resetAt сброшен)`);
  } catch (err) {
    log(`⚠️ [autologin] ${account.id}: не удалось обновить пул-слот (${err?.message})`);
  }

  return result;
}

// Шаги логина на открытой странице / или /auth.
async function performQwenLogin(page, email, password, { log } = {}) {
  await page.waitForLoadState("domcontentloaded");

  // 0) cookie-баннер
  await acceptCookieBanner(page);

  // 1) Уже залогинен? (JWT мог появиться между вайпом и goto)
  //    Проверяем через localStorage — если токен есть, выходим.
  //    (loginQwenAndSave с clearSession гарантирует отсутствие старого.)
  // 2) Кнопка «Войти» на главной
  const loginBtn = page.locator("button", { hasText: "Войти" }).first();
  try {
    await loginBtn.waitFor({ state: "visible", timeout: 8000 });
  } catch {
    // Может быть на /auth уже — продолжаем
  }
  if (await loginBtn.isVisible().catch(() => false)) {
    await loginBtn.click({ delay: randInt(40, 110) });
    await humanPause();
  }

  // 3) Поле email на /auth
  const emailInput = page.locator('input[name="email"]').first();
  await emailInput.waitFor({ state: "visible", timeout: 15_000 });
  await humanPause(600, 1400);
  await humanType(page, 'input[name="email"]', email);
  await humanPause();

  // 4) «Войти с паролем»
  const byPassword = page.locator("button", { hasText: "Войти с паролем" }).first();
  await byPassword.click({ delay: randInt(40, 110) });
  await humanPause(900, 1900);

  // 5) Поле пароля
  const passInput = page.locator('input[name="password"]').first();
  await passInput.waitFor({ state: "visible", timeout: 10_000 });
  await humanType(page, 'input[name="password"]', password);
  await humanPause(500, 1200);

  // 6) Кнопка «Войти» (submit)
  const submitBtn = page.locator("button", { hasText: "Войти" }).first();
  await submitBtn.click({ delay: randInt(40, 110) });

  // 7) Ждём ухода с /auth (до 60с): либо чат, либо ошибка/капча.
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    const url = page.url();
    if (!url.includes("/auth")) {
      log(`🤖 [autologin] ушёл с /auth → ${url}`);
      return;
    }
    // Baxia-слайдер? Пробуем автосолвер (уже проверен в проде на чатах).
    if (url.includes("_____tmd_____/punish")) {
      const { trySolveBaxiaOnPage } = await import("./baxia-solver.mjs");
      const res = await trySolveBaxiaOnPage(page, undefined, { log: (m) => log(`🤖 [autologin] baxia: ${m}`) });
      if (!res?.solved) log(`🤖 [autologin] baxia не решён (${res?.error || "?"}) — ждём`);
      await humanPause(1500, 3000);
      continue;
    }
    await sleep(1000);
  }
  throw new Error(`autologin: не ушёл с /auth за 60с (последний url: ${page.url()})`);
}
