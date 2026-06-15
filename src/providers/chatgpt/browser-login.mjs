import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { findChromeBinary, launchPersistentDeepSeekContext } from "../../browser/launch.mjs";
import {
  CHATGPT_AUTH_FILE,
  CHATGPT_BASE_URL,
  CHATGPT_BROWSER_PROFILE,
} from "./config.mjs";
import {
  writeChatGPTAuth,
  clearBrowserCookiesViaCdp,
  pickEssentialChatGPTCookies,
} from "./auth-files.mjs";

async function readSessionFromPage(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/session", {
      method: "GET",
      credentials: "include",
      headers: { "Accept": "application/json" },
    });
    if (!response.ok) {
      return null;
    }
    return response.json();
  });
}

async function isChatGPTChallengePage(page) {
  try {
    return await page.evaluate(() => {
      const title = String(document.title || "");
      const text = String(document.body?.innerText || "");
      return /cloudflare|confirm.*human|verify.*human|подтвердите.*человек|идет проверка|один момент/i.test(`${title}\n${text}`);
    });
  } catch {
    return true;
  }
}

function reserveLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function connectOverCDP(chromium, port, timeoutMs = 45_000) {
  const endpoint = `http://127.0.0.1:${port}`;
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      return await chromium.connectOverCDP(endpoint);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Не удалось подключиться к Chrome через ${endpoint}: ${lastError?.message || "timeout"}`);
}

// Убиваем «зависшие» Chrome, которые держат именно этот профиль. Браузер запускается
// detached+unref и переживает выход/перезапуск приложения, из-за чего профиль остаётся
// заблокированным и новый Chrome выдаёт «Не удалось открыть профиль».
export function killStaleChromeForProfile(profileDir) {
  try {
    if (process.platform === "win32") {
      const escaped = String(profileDir).replace(/'/g, "''");
      const result = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `$p = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--user-data-dir=${escaped}*' }; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; exit 0 } else { exit 1 }`,
        ],
        { stdio: "ignore", timeout: 10_000 },
      );
      return result.status === 0;
    }
    // -f сопоставляет полную командную строку, поэтому путь профиля делает матч точечным
    // и не трогает обычный Chrome пользователя. Код 0 = что-то совпало и было убито.
    const result = spawnSync("pkill", ["-f", `--user-data-dir=${profileDir}`], {
      stdio: "ignore",
      timeout: 10_000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function cleanupChromeProfileForLaunch(profileDir, { clearCookies = false } = {}) {
  fs.mkdirSync(profileDir, { recursive: true });
  for (const file of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try { fs.unlinkSync(path.join(profileDir, file)); } catch {}
  }
  if (!clearCookies) return;
  const defaultDir = path.join(profileDir, "Default");
  for (const rel of [
    "Cookies",
    "Cookies-journal",
    "Network/Cookies",
    "Network/Cookies-journal",
    "Network Persistent State",
    "TransportSecurity",
  ]) {
    try { fs.unlinkSync(path.join(defaultDir, rel)); } catch {}
  }
}

// Полная «ремонтная» очистка профиля перед логином: убирает раздутые cookies с диска.
export function repairChatGPTBrowserProfile(profileDir = CHATGPT_BROWSER_PROFILE) {
  killStaleChromeForProfile(profileDir);
  cleanupChromeProfileForLaunch(profileDir, { clearCookies: true });
}

async function isChatGPTPageUnavailable(page) {
  try {
    return await page.evaluate(() => {
      const text = String(document.body?.innerText || "");
      return /HTTP ERROR 431|страница недоступна|page unavailable/i.test(text);
    });
  } catch {
    return false;
  }
}

async function openChatGPTForLogin(page, context) {
  const target = `${CHATGPT_BASE_URL}/`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await clearBrowserCookiesViaCdp(page, context);
    try {
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 90_000 });
    } catch (error) {
      if (attempt === 0) continue;
      throw error;
    }
    if (!(await isChatGPTPageUnavailable(page))) return;
    if (attempt === 0) {
      cleanupChromeProfileForLaunch(CHATGPT_BROWSER_PROFILE, { clearCookies: true });
      await clearBrowserCookiesViaCdp(page, context);
    }
  }
  throw new Error(
    "ChatGPT: страница недоступна (HTTP 431 — слишком много cookies). Профиль очищен, попробуй «Войти» ещё раз.",
  );
}

export async function launchNormalChromeForChatGPT(
  chromium,
  profileDir,
  { initialUrl = CHATGPT_BASE_URL, clearCookies = false, offscreen = false, headless = false, skipKillStale = false } = {},
) {
  const chromeBinary = findChromeBinary();
  if (!chromeBinary) {
    return null;
  }

  // Сначала закрываем зомби-Chrome, держащий профиль, иначе будет «Не удалось открыть профиль».
  if (!skipKillStale) {
    const killedStale = killStaleChromeForProfile(profileDir);
    if (killedStale) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  cleanupChromeProfileForLaunch(profileDir, { clearCookies });
  const port = await reserveLocalPort();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (headless) {
    // Тот же Google Chrome и профиль, но без окна — cookies из логина читаются корректно.
    args.push("--headless=new", "--disable-gpu");
  } else {
    args.push("--new-window");
    if (offscreen) {
      args.push("--window-position=-32000,-32000", "--window-size=1280,900");
    }
  }
  args.push(initialUrl || "about:blank");
  let chromeProcess = null;
  let browser = null;
  try {
    chromeProcess = spawn(chromeBinary, args, {
      detached: true,
      stdio: "ignore",
    });
    chromeProcess.unref();
    browser = await connectOverCDP(chromium, port);
  } catch (error) {
    try { chromeProcess?.kill("SIGTERM"); } catch {}
    try { if (chromeProcess?.pid) process.kill(-chromeProcess.pid, "SIGTERM"); } catch {}
    return null;
  }
  const context = browser.contexts()[0] || null;
  if (!context) {
    await browser.close().catch(() => {});
    throw new Error("Chrome открылся, но CDP-контекст недоступен.");
  }
  if (clearCookies) {
    try { await context.clearCookies(); } catch {}
  }

  const page = context.pages().find((item) => item.url().includes("chatgpt.com"))
    || context.pages()[0]
    || await context.newPage();
  if (initialUrl && page.url() !== initialUrl) {
    await page.goto(initialUrl, { waitUntil: "domcontentloaded" });
  }
  return {
    context,
    page,
    close: async () => {
      try {
        const cdp = await browser.newBrowserCDPSession();
        await cdp.send("Browser.close");
      } catch {}
      try { await browser.close(); } catch {}
      try { chromeProcess.kill("SIGTERM"); } catch {}
      try { process.kill(-chromeProcess.pid, "SIGTERM"); } catch {}
    },
    mode: "chrome-cdp",
  };
}

async function launchPlaywrightChromeForLogin(chromium, profileDir) {
  cleanupChromeProfileForLaunch(profileDir, { clearCookies: true });
  const context = await launchPersistentDeepSeekContext(chromium, profileDir, false, {
    args: [],
    chromiumSandbox: true,
  });
  const page = context.pages()[0] || (await context.newPage());
  await clearBrowserCookiesViaCdp(page, context);
  await openChatGPTForLogin(page, context);
  return {
    context,
    page,
    close: async () => {
      try { await context.close(); } catch {}
    },
    mode: "playwright",
  };
}

export async function importChatGPTFromJson(jsonPath, authFile = CHATGPT_AUTH_FILE) {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Файл не найден: ${jsonPath}`);
  }

  let rawData;
  try {
    rawData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch (error) {
    throw new Error(`Невалидный JSON в ${jsonPath}: ${error.message}`);
  }

  let accessToken = "";
  let sessionToken = "";
  let cookies = [];

  if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
    accessToken = rawData.accessToken || "";
    sessionToken = rawData.sessionToken || "";
    if (sessionToken && !cookies.some((c) => c.name === "__Secure-next-auth.session-token")) {
      cookies.push({
        name: "__Secure-next-auth.session-token",
        value: sessionToken,
        domain: ".chatgpt.com",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      });
    }
    if (Array.isArray(rawData.cookies)) {
      cookies.push(...rawData.cookies);
    }
  } else if (Array.isArray(rawData)) {
    cookies = rawData;
    const sessionCookie = cookies.find((c) => c.name === "__Secure-next-auth.session-token");
    if (sessionCookie) {
      sessionToken = sessionCookie.value;
    }
  }

  if (!sessionToken && !accessToken) {
    throw new Error("В файле импорта не найден sessionToken или accessToken.");
  }

  const profileDir = CHATGPT_BROWSER_PROFILE;
  const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

  writeChatGPTAuth(authFile, {
    cookies,
    accessToken,
    sessionToken,
    profileDir,
    userAgent,
  });

  console.log(`✅ Успешно импортировано сессию ChatGPT (sessionToken: ${sessionToken ? "присутствует" : "отсутствует"}, accessToken: ${accessToken ? "присутствует" : "отсутствует"})`);
  return { accessToken, sessionToken, cookies };
}

export async function loginChatGPTAndSave(authFile = CHATGPT_AUTH_FILE) {
  const profileDir = CHATGPT_BROWSER_PROFILE;
  const { resetChatGPTBrowserProxy } = await import("./browser-proxy.mjs");
  resetChatGPTBrowserProxy();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  repairChatGPTBrowserProfile(profileDir);

  const { getChatGPTChromium } = await import("./engine.mjs");
  const chromium = await getChatGPTChromium();
  const session = await launchNormalChromeForChatGPT(chromium, profileDir, {
    initialUrl: "about:blank",
    clearCookies: true,
    skipKillStale: true,
  })
    || await launchPlaywrightChromeForLogin(chromium, profileDir);
  const { context, page } = session;

  await clearBrowserCookiesViaCdp(page, context);
  await openChatGPTForLogin(page, context);

  console.log("🔓 Открываем окно ChatGPT (chatgpt.com).");
  console.log("   • Пройдите Cloudflare вручную, если появится чекбокс.");
  console.log("   • Затем залогиньтесь вручную (Google, email, etc.).");
  console.log("   • Окно останется открытым — через него идут все запросы к ChatGPT.");
  if (session.mode === "chrome-cdp") {
    console.log("   • Используется обычный Google Chrome, не Playwright Chromium.");
  }

  let captured;
  try {
    captured = await new Promise((resolve, reject) => {
      let done = false;
      let interval = null;
      const timeout = setTimeout(() => {
        if (done) return;
        done = true;
        if (interval) clearInterval(interval);
        reject(new Error("Превышено время ожидания входа (10 минут)."));
      }, 10 * 60 * 1000);

      const captureCurrentSession = async () => {
        if (done) return;
        try {
          if (await isChatGPTChallengePage(page)) return;
          const body = await readSessionFromPage(page);
          if (body && body.accessToken) {
            done = true;
            clearTimeout(timeout);
            clearInterval(interval);
            const cookies = pickEssentialChatGPTCookies(await context.cookies());
            const userAgent = await page.evaluate(() => navigator.userAgent);
            resolve({
              accessToken: body.accessToken,
              sessionToken: body.sessionToken || cookies.find((c) => c.name === "__Secure-next-auth.session-token")?.value || "",
              cookies,
              userAgent,
            });
          }
        } catch {}
      };

      interval = setInterval(captureCurrentSession, 5000);

      context.on("response", async (response) => {
        if (done) return;
        try {
          const url = response.url();
          if (url.includes("/api/auth/session")) {
            if (response.status() === 200) {
              const body = await response.json();
              if (body && body.accessToken) {
                done = true;
                clearTimeout(timeout);
                clearInterval(interval);
                const cookies = pickEssentialChatGPTCookies(await context.cookies());
                const userAgent = await page.evaluate(() => navigator.userAgent);
                resolve({
                  accessToken: body.accessToken,
                  sessionToken: body.sessionToken || cookies.find((c) => c.name === "__Secure-next-auth.session-token")?.value || "",
                  cookies,
                  userAgent,
                });
              }
            }
          }
        } catch (e) {}
      });

      setTimeout(captureCurrentSession, 3000);
    });
  } catch (error) {
    await session.close();
    throw error;
  }

  writeChatGPTAuth(authFile, {
    cookies: captured.cookies,
    accessToken: captured.accessToken,
    sessionToken: captured.sessionToken,
    profileDir,
    userAgent: captured.userAgent,
  });

  const { adoptChatGPTBrowserSession } = await import("./browser-proxy.mjs");
  adoptChatGPTBrowserSession(session, { debug: Boolean(process.env.DEEPSEEK_DEBUG_CHATGPT) });
  console.log("✅ Успешный вход в ChatGPT! Окно браузера остаётся открытым.");
  return captured;
}
