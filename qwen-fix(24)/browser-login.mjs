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

// Главный entry-point для `npm run login-qwen` и in-app re-login.
export async function loginQwenAndSave(authFile = QWEN_AUTH_FILE, { clearSession = false } = {}) {
  const profileDir = QWEN_BROWSER_PROFILE;
  const previousToken = clearSession ? (readQwenAuth(authFile)?.token || "") : "";
  const { getChatGPTChromium } = await import("../chatgpt/engine.mjs");
  const chromium = await getChatGPTChromium();
  // Переиспользуем launch-функцию от DeepSeek — она запускает реальный Chrome.
  const context = await launchPersistentDeepSeekContext(chromium, profileDir, false);

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

  if (clearSession) {
    console.log("🔒 Сбрасываю старую сессию Qwen в профиле — нужен новый вход.");
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
    captured = await waitForQwenToken(context, { previousToken });
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }

  await page.evaluate((token) => {
    try { localStorage.setItem("token", token); } catch {}
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

// Ждём, пока появится валидный JWT.
//
// Qwen в старой версии клал токен в httpOnly-куку `token`. В новой версии
// (середина 2026) токен переехал в localStorage["token"], а в куках лежат
// только `refresh_token`, `aui`, `cnaui` и антибот-Alibaba куки. Поэтому
// проверяем оба места: сначала старую куку (для обратной совместимости),
// затем localStorage["token"].
//
// previousToken — при re-login не принимаем тот же JWT, что был до сброса сессии.
async function waitForQwenToken(
  context,
  {
    timeoutMs = 5 * 60 * 1000,
    intervalMs = 1000,
    previousToken = "",
  } = {},
) {
  const startedAt = Date.now();

  let lastCookieSignature = "";
  let lastStorageSignature = "";

  while (Date.now() - startedAt < timeoutMs) {
    let cookies = [];

    try {
      cookies = await context.cookies(QWEN_BASE_URL);
    } catch (err) {
      console.warn(
        "[qwen-login] Не удалось получить cookies:",
        err?.message || err,
      );

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }

    // ------------------------------------------------------------
    // 1. Старый вариант: token в cookie
    // ------------------------------------------------------------
    const tokenCookie = cookies.find(
      (cookie) => cookie.name === QWEN_TOKEN_COOKIE_NAME,
    );

    if (tokenCookie?.value) {
      const token = tokenCookie.value;

      if (!previousToken || token !== previousToken) {
        console.log(
          `[qwen-login] Найден token cookie (${token.length} chars)`,
        );

        return {
          token,
          cookies,
          userId:
            cookies.find((c) => c.name === "cnaui")?.value ||
            cookies.find((c) => c.name === "aui")?.value ||
            "",
        };
      }
    }

    // ------------------------------------------------------------
    // 2. Новый вариант Qwen: token в localStorage
    // ------------------------------------------------------------
    const pages = context.pages();

    // Ищем страницу Qwen.
    const qwenPage =
      pages.find((page) => {
        try {
          const url = new URL(page.url());
          return (
            url.hostname === "chat.qwen.ai" ||
            url.hostname.endsWith(".qwen.ai")
          );
        } catch {
          return false;
        }
      }) || pages[0];

    if (qwenPage) {
      try {
        const storage = await qwenPage.evaluate(() => {
          const token = localStorage.getItem("token");
          const accessTokenState =
            localStorage.getItem("qwen_access_token_state");
          const expireTime =
            localStorage.getItem("at_expire_time");

          // ДЕТАЛЬНАЯ ДИАГНОСТИКА qwen_access_token_state:
          // Нужно понять, что там лежит — это сам access_token строкой,
          // или JSON с полями {access_token, refresh_token, expires_at}?
          // Логируем только структуру и типы, БЕЗ значений.
          let accessTokenStateInfo = null;
          if (accessTokenState) {
            accessTokenStateInfo = {
              length: accessTokenState.length,
              type: typeof accessTokenState,
              firstChar: accessTokenState[0],
              // Если это JSON — покажем ключи верхнего уровня
              jsonKeys: null,
              // Если внутри есть JWT (3 части через точку) — покажем
              // exp/iat этого JWT
              jwtExp: null,
              jwtIat: null,
              jwtPayloadType: null,
            };
            try {
              const parsed = JSON.parse(accessTokenState);
              accessTokenStateInfo.jsonKeys = Object.keys(parsed);
              // Ищем поле, которое выглядит как JWT
              for (const [key, value] of Object.entries(parsed)) {
                if (typeof value === "string" && value.split(".").length === 3) {
                  try {
                    const payload = JSON.parse(
                      atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
                    );
                    accessTokenStateInfo.jwtExp = payload.exp || null;
                    accessTokenStateInfo.jwtIat = payload.iat || null;
                    accessTokenStateInfo.jwtPayloadType = payload.type || null;
                    accessTokenStateInfo.jwtField = key;
                    break;
                  } catch {}
                }
              }
            } catch {
              // Не JSON — возможно, это просто строка (JWT?)
              if (accessTokenState.split(".").length === 3) {
                try {
                  const payload = JSON.parse(
                    atob(accessTokenState.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
                  );
                  accessTokenStateInfo.jwtExp = payload.exp || null;
                  accessTokenStateInfo.jwtIat = payload.iat || null;
                  accessTokenStateInfo.jwtPayloadType = payload.type || null;
                } catch {}
              }
            }
          }

          return {
            token,
            accessTokenState,
            accessTokenStateInfo,
            expireTime,
            keys: Object.keys(localStorage),
          };
        });

        // Диагностика без вывода секретных значений.
        const signature = JSON.stringify({
          hasToken: Boolean(storage.token),
          hasAccessTokenState: Boolean(storage.accessTokenState),
          hasExpireTime: Boolean(storage.expireTime),
          accessTokenStateInfo: storage.accessTokenStateInfo,
          keys: storage.keys,
        });

        if (signature !== lastStorageSignature) {
          lastStorageSignature = signature;

          console.log(
            "[qwen-login] localStorage:",
            {
              hasToken: Boolean(storage.token),
              hasAccessTokenState: Boolean(
                storage.accessTokenState,
              ),
              hasExpireTime: Boolean(storage.expireTime),
              accessTokenStateInfo: storage.accessTokenStateInfo,
              keys: storage.keys,
            },
          );
        }

        // --------------------------------------------------------
        // Новый Qwen token
        // --------------------------------------------------------
        //
        // ВАЖНО: в localStorage есть ДВА токена:
        //   1. localStorage["token"] — 14-дневный session token.
        //      Qwen API его НЕ ПРИНИМАЕТ для /api/v2/* запросов!
        //   2. localStorage["qwen_access_token_state"] — JSON с полем
        //      "token", внутри которого лежит НАСТОЯЩИЙ 15-минутный
        //      access_token (JWT с type:"access_token", TTL=900s).
        //      Именно его принимает Qwen API.
        //
        // Поэтому предпочитаем access_token из qwen_access_token_state,
        // а localStorage["token"] используем только как fallback (для
        // обратной совместимости со старыми версиями Qwen, где токен
        // лежал прямо в localStorage["token"]).
        const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
        let realAccessToken = "";
        let realAccessTokenSource = "";

        if (storage.accessTokenState) {
          try {
            const parsed = JSON.parse(storage.accessTokenState);
            if (parsed?.token && JWT_RE.test(parsed.token)) {
              realAccessToken = parsed.token;
              realAccessTokenSource = "qwen_access_token_state.token";
            }
          } catch {}
        }

        if (!realAccessToken && storage.token && JWT_RE.test(storage.token)) {
          realAccessToken = storage.token;
          realAccessTokenSource = "localStorage.token (fallback)";
        }

        if (realAccessToken) {
          const token = realAccessToken;

          if (!previousToken || token !== previousToken) {
            console.log(
              `[qwen-login] Найден Qwen access_token (${token.length} chars, source: ${realAccessTokenSource})`,
            );

            // Не печатаем сам token в терминал.
            return {
              token,
              cookies,
              userId:
                cookies.find((c) => c.name === "cnaui")?.value ||
                cookies.find((c) => c.name === "aui")?.value ||
                "",
              source: realAccessTokenSource,
              accessTokenState: storage.accessTokenState,
              expireTime: storage.expireTime,
            };
          }
        }
      } catch (err) {
        console.warn(
          "[qwen-login] Не удалось прочитать localStorage:",
          err?.message || err,
        );
      }
    }

    // ------------------------------------------------------------
    // 3. Диагностика cookies (без значений — только имена/домены)
    // ------------------------------------------------------------
    const cookieSignature = cookies
      .map(
        (cookie) =>
          `${cookie.name}|${cookie.domain}|${cookie.httpOnly}|${cookie.secure}`,
      )
      .sort()
      .join("\n");

    if (cookieSignature !== lastCookieSignature) {
      lastCookieSignature = cookieSignature;

      console.log(
        "[qwen-login] cookies seen:",
        cookies.map((cookie) => ({
          name: cookie.name,
          domain: cookie.domain,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
        })),
      );
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  // --------------------------------------------------------------
  // Timeout
  // --------------------------------------------------------------
  const finalCookies = await context
    .cookies(QWEN_BASE_URL)
    .catch(() => []);

  throw new Error(
    [
      `Qwen login timeout (${Math.round(timeoutMs / 1000)}s).`,
      'Не найден ни cookie "token", ни localStorage["token"].',
      `Cookies: ${finalCookies.map((cookie) => cookie.name).join(", ") || "(none)"}`,
    ].join(" "),
  );
}

// Считать JWT и куки из уже открытого контекста (после goto на chat.qwen.ai).
//
// Сначала проверяем старую куку `token`. Если её нет (Qwen новой версии
// переехал на localStorage["token"]) — читаем localStorage.
async function captureQwenAuthFromContext(context, authFile, profileDir) {
  const cookies = await context.cookies(QWEN_BASE_URL);
  const tokenCookie = cookies.find((c) => c.name === QWEN_TOKEN_COOKIE_NAME);
  let token = tokenCookie?.value || "";
  let looksLikeJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);

  // Fallback: новый Qwen хранит токен в localStorage["token"], не в куке.
  if (!looksLikeJwt) {
    const pages = context.pages();
    const qwenPage =
      pages.find((page) => {
        try {
          const url = new URL(page.url());
          return (
            url.hostname === "chat.qwen.ai" ||
            url.hostname.endsWith(".qwen.ai")
          );
        } catch {
          return false;
        }
      }) || pages[0];

    if (qwenPage) {
      try {
        // Читаем оба ключа localStorage. Предпочитаем qwen_access_token_state
        // (настоящий 15-минутный access_token), fallback на token.
        const lsData = await qwenPage.evaluate(() => {
          try {
            return {
              token: localStorage.getItem("token") || "",
              accessTokenState: localStorage.getItem("qwen_access_token_state") || "",
            };
          } catch {
            return { token: "", accessTokenState: "" };
          }
        });

        const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
        let realToken = "";

        // Путь 1: qwen_access_token_state.token (НАСТОЯЩИЙ access_token)
        if (lsData.accessTokenState) {
          try {
            const parsed = JSON.parse(lsData.accessTokenState);
            if (parsed?.token && JWT_RE.test(parsed.token)) {
              realToken = parsed.token;
            }
          } catch {}
        }

        // Путь 2 (fallback): localStorage["token"]
        if (!realToken && lsData.token && JWT_RE.test(lsData.token)) {
          realToken = lsData.token;
        }

        if (realToken) {
          token = realToken;
          looksLikeJwt = true;
        }
      } catch (err) {
        console.warn(
          "[qwen-capture] Не удалось прочитать localStorage:",
          err?.message || err,
        );
      }
    }
  }

  if (!looksLikeJwt) {
    throw new Error(
      "В профиле Qwen нет валидного JWT ни в cookie, ни в localStorage. " +
      "Залогинься: npm run login-qwen",
    );
  }

  const userId =
    cookies.find((c) => c.name === "cnaui")?.value ||
    cookies.find((c) => c.name === "aui")?.value ||
    "";

  writeQwenAuth(authFile, { cookies, token, userId, profileDir });
  return {
    token,
    userId,
    cookieHeader: qwenCookieHeaderFromArray(cookies),
    cookies,
    source: authFile,
  };
}

// Тихий refresh: headless Chromium с тем же профилем, что при login-qwen.
//
// Как это работает:
//   1. Открываем chat.qwen.ai в headless Chromium с persistent-профилем.
//   2. SPA Qwen сама дёргает GET /api/v2/auths/refresh при загрузке —
//      refresh_token лежит как httpOnly-кука на auth.qwen.ai и автоматически
//      отправляется с запросом. Сервер возвращает новый access_token.
//   3. SPA кладёт новый токен в localStorage["token"].
//   4. Мы ждём, пока в localStorage появится валидный (не протухший) JWT,
//      и сохраняем его в auth.json.
//
// Если Google OAuth в persistent-профиле жив (а он по наблюдениям живёт
// неделями) — silent refresh работает неделями без видимого окна.
// Если Google OAuth протух — SPA не сможет сделать refresh, токен не
// появится, мы кидаем ошибку → QwenAuthManager откроет visible re-login.
//
// Логика ожидания (ВАЖНО — иначе гонка):
//   • Если previousToken ещё валидный И refresh не обязателен — выходим сразу,
//     возвращаем previousToken. Это случай "произвольная проверка".
//   • Если previousToken протух или скоро протухнет — обязаны дождаться
//     ДРУГОГО токена (lsToken !== previousToken). Иначе мы прочитаем старый
//     токен из localStorage и уйдём, не дождавшись SPA refresh.
const SILENT_REFRESH_MAX_WAIT_MS = 20_000;
const SILENT_REFRESH_POLL_MS = 500;
const SILENT_REFRESH_SKEW_SEC = 60; // считаем протухшим, если exp < now + 60s

function decodeJwtExp(jwt) {
  try {
    const parts = String(jwt).split(".");
    if (parts.length < 2) return 0;
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
    return Number(payload.exp) || 0;
  } catch {
    return 0;
  }
}

function isJwtValid(jwt, skewSec = SILENT_REFRESH_SKEW_SEC) {
  if (!jwt || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt)) return false;
  const exp = decodeJwtExp(jwt);
  if (!exp) return false;
  const now = Math.floor(Date.now() / 1000);
  return exp - now > skewSec;
}

// requireFreshToken = true → обязаны дождаться нового токена (lsToken !== previousToken).
//   Это случай когда proactive refresh вызвал функцию из-за того, что
//   предыдущий токен скоро протухнет — даже если он ещё формально валидный,
//   нам НЕЛЬЗЯ вернуть его же.
// requireFreshToken = false → можем вернуть previousToken, если он ещё валидный
//   и SPA не сделала refresh (нет нужды дёргать сервер лишний раз).
export async function refreshQwenAuthFromProfile(authFile = QWEN_AUTH_FILE, { requireFreshToken = true, force = false } = {}) {
  if (!fs.existsSync(authFile)) {
    throw new Error(`Qwen auth file not found: ${authFile}`);
  }

  let profileDir = QWEN_BROWSER_PROFILE;
  let previousToken = "";
  try {
    const saved = JSON.parse(fs.readFileSync(authFile, "utf8"));
    if (saved?.profileDir) profileDir = saved.profileDir;
    if (saved?.token) {
      previousToken = String(saved.token);
    }
  } catch {
    // используем дефолтный профиль
  }

  // Если предыдущий токен ещё живой И нам не нужен обязательно свежий И
  // мы не в режиме force (когда 401 от API игнорирует exp) — не дёргаем
  // браузер лишний раз. Просто вернём как есть.
  // Это защитит от лишних headless-Chromium запусков при каждом вызове refresh().
  //
  // ВАЖНО: force=true обходится, потому что сервер Qwen может отозвать токен
  // досрочно (антибот), и тогда exp будет ещё в будущем, но токен уже невалиден.
  if (!requireFreshToken && !force && isJwtValid(previousToken)) {
    // Возвращаем структуру как readQwenAuth, без перечитывания куки.
    return readQwenAuth(authFile);
  }

  const debug = Boolean(process.env.DEEPSEEK_DEBUG_QWEN);

  // === Путь 1 (предпочтительный): переиспользовать активный browser-proxy ===
  // В реальном ai-free browser-proxy уже поднят с persistent-профилем Qwen.
  // Поднимать второй Chromium с тем же профилем нельзя — Chromium ProcessSingleton
  // упадёт с "Profile in use". Поэтому сначала пробуем refresh через метод
  // reloadAndCaptureFreshToken в активном browser-proxy.
  try {
    const { isQwenBrowserProxyActive, getQwenBrowserProxy } = await import("./browser-proxy.mjs");
    if (typeof isQwenBrowserProxyActive === "function" && isQwenBrowserProxyActive()) {
      if (debug) console.log("[qwen-refresh] using active browser-proxy for SPA reload…");
      const proxy = await getQwenBrowserProxy({ debug });
      const captured = await proxy.reloadAndCaptureFreshToken({
        previousToken,
        maxWaitMs: SILENT_REFRESH_MAX_WAIT_MS,
        debug,
        force,
      });

      if (captured) {
        if (debug) console.log("[qwen-refresh] fresh token captured via browser-proxy");
        const { writeQwenAuth } = await import("./auth-files.mjs");
        writeQwenAuth(authFile, {
          cookies: captured.cookies,
          token: captured.token,
          userId: captured.userId,
          profileDir,
        });
        return readQwenAuth(authFile);
      }

      if (debug) console.warn("[qwen-refresh] browser-proxy returned null, falling through to standalone Chromium");
    }
  } catch (err) {
    if (debug) console.warn(`[qwen-refresh] browser-proxy path failed: ${err.message}`);
  }

  // === Путь 2 (fallback): поднять свой headless Chromium с persistent-профилем ===
  // Срабатывает только если browser-proxy не активен (например, при первом
  // вызове refresh до того, как был сделан первый API-запрос).
  const { getChatGPTChromium } = await import("../chatgpt/engine.mjs");
  const chromium = await getChatGPTChromium();
  const context = await launchPersistentDeepSeekContext(chromium, profileDir, true);
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(QWEN_BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Ждём, пока SPA сделает /api/v2/auths/refresh и положит новый токен
    // в localStorage["token"]. Критично: проверяем что токен ОТЛИЧАЕТСЯ
    // от previousToken — иначе мы просто перечитаем старый, не дождавшись
    // refresh, и silent refresh будет бесполезным.
    const startedAt = Date.now();
    const debug = Boolean(process.env.DEEPSEEK_DEBUG_QWEN);
    let lastLogAt = 0;
    while (Date.now() - startedAt < SILENT_REFRESH_MAX_WAIT_MS) {
      await page.waitForTimeout(SILENT_REFRESH_POLL_MS);
      const lsToken = await page.evaluate(() => {
        try { return localStorage.getItem("token") || ""; } catch { return ""; }
      }).catch(() => "");

      const elapsed = Date.now() - startedAt;
      if (debug && elapsed - lastLogAt > 2000) {
        lastLogAt = elapsed;
        console.log(`[qwen-refresh] waiting for fresh token… ${Math.round(elapsed / 1000)}s elapsed`);
      }

      // Условие успеха: токен есть, валидный, И
      //   • либо он отличается от previousToken (SPA сделала refresh), ИЛИ
      //   • previousToken не было вообще (первый логин).
      // Если токен совпадает с previousToken — продолжаем ждать, потому что
      // это означает что SPA ещё не успела сделать refresh.
      if (lsToken && isJwtValid(lsToken) && (!previousToken || lsToken !== previousToken)) {
        // Сохраняем в localStorage, чтобы captureQwenAuthFromContext тоже его увидел.
        await page.evaluate((t) => {
          try { localStorage.setItem("token", t); } catch {}
        }, lsToken).catch(() => {});
        break;
      }
    }

    return await captureQwenAuthFromContext(context, authFile, profileDir);
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
