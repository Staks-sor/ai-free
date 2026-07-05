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
import { withChatGPTProfileLock } from "./chrome-profile-lock.mjs";

// Не передаём --disable-blink-features=AutomationControlled: Chrome/ChatGPT показывают
// предупреждение и Cloudflare режет такую сессию.

// Embed: headed Chrome за экраном (как обычный браузер для Cloudflare). CHATGPT_EMBED_HEADED=0 — headless.
export function getChatGPTBrowserLaunchOptions() {
  if (process.env.CHATGPT_HEADLESS === "0") {
    return { useExternalChrome: true, headless: false, offscreen: false, internalHeadless: false, preferBundled: false, applyStealth: false };
  }
  if (process.env.CHATGPT_HEADLESS === "1") {
    return { useExternalChrome: true, headless: true, offscreen: false, internalHeadless: true, preferBundled: false, applyStealth: false };
  }
  if (process.env.CHATGPT_EMBED_IN_UI === "1") {
    const headless = process.env.CHATGPT_EMBED_HEADED === "0";
    return {
      useExternalChrome: false,
      headless,
      offscreen: !headless,
      internalHeadless: headless,
      preferBundled: false,
      applyStealth: false,
    };
  }
  return { useExternalChrome: true, headless: false, offscreen: false, internalHeadless: false, preferBundled: false, applyStealth: false };
}

export {
  tryAssistCloudflareClick,
  detectCloudflareChallenge,
  waitForCloudflareClearance,
  trySolveTurnstileCheckbox,
} from "./cloudflare-challenge.mjs";

export async function launchInternalBrowserContext(
  chromium,
  profileDir,
  {
    viewport = { width: 1280, height: 900 },
    headless = true,
    userAgent,
    offscreen = false,
    preferBundled = false,
    applyStealth = false,
  } = {},
) {
  fs.mkdirSync(profileDir, { recursive: true });
  cleanupChromeProfileForLaunch(profileDir, { clearCookies: false });

  const windowArgs = offscreen
    ? [
      "--window-position=-24000,-24000",
      `--window-size=${viewport.width},${viewport.height}`,
      "--start-minimized",
    ]
    : [];

  const launchOptions = {
    headless,
    viewport,
    locale: "en-US",
    ignoreDefaultArgs: ["--enable-automation"],
    args: windowArgs,
    ...(userAgent ? { userAgent } : {}),
  };

  let context;
  if (preferBundled) {
    context = await chromium.launchPersistentContext(profileDir, launchOptions);
  } else {
    try {
      context = await chromium.launchPersistentContext(profileDir, { ...launchOptions, channel: "chrome" });
    } catch {
      cleanupChromeProfileForLaunch(profileDir, { clearCookies: false });
      context = await chromium.launchPersistentContext(profileDir, launchOptions);
    }
  }

  if (applyStealth) {
    await applyChatGPTStealth(context);
  }
  const page = context.pages()[0] || (await context.newPage());
  return {
    context,
    page,
    close: async () => {
      try { await context.close(); } catch {}
    },
    mode: "internal",
  };
}

export function cleanupStaleBrowserProfiles(profileDirs = []) {
  let killed = false;
  for (const profileDir of profileDirs) {
    if (killStaleChromeForProfile(profileDir)) killed = true;
    cleanupChromeProfileForLaunch(profileDir, { clearCookies: false });
  }
  return killed;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {Promise<void> | null} */
let profileReadyPromise = null;

// Один раз перед первым in-app Chrome: убить зомби и снять locks.
export function ensureChatGPTProfileReady(profileDir = CHATGPT_BROWSER_PROFILE) {
  if (!profileReadyPromise) {
    profileReadyPromise = withChatGPTProfileLock(() => prepareChromeProfileForLaunchInternal(profileDir, { clearCookies: false }));
  }
  return profileReadyPromise;
}

export function resetChatGPTProfileReady() {
  profileReadyPromise = null;
}

// Перед spawn Chrome: убить зомби, подождать, снять lock-файлы.
async function prepareChromeProfileForLaunchInternal(profileDir, { clearCookies = false } = {}) {
  let killed = killStaleChromeForProfile(profileDir);
  const lockPath = path.join(profileDir, "SingletonLock");
  if (!killed && fs.existsSync(lockPath)) {
    killed = killStaleChromeForProfile(profileDir);
  }
  if (killed) {
    await sleep(2000);
  }
  cleanupChromeProfileForLaunch(profileDir, { clearCookies });
  await sleep(300);
}

export async function prepareChromeProfileForLaunch(profileDir, options = {}) {
  return withChatGPTProfileLock(() => prepareChromeProfileForLaunchInternal(profileDir, options));
}

async function minimizeEmbeddedChromeWindows(browser, viewport) {
  let cdp;
  try {
    cdp = await browser.newBrowserCDPSession();
  } catch {
    return;
  }

  const minimizeOnce = async () => {
    try {
      const { targetInfos } = await cdp.send("Target.getTargets");
      const seen = new Set();
      for (const target of targetInfos || []) {
        if (target.type !== "page" || !target.targetId) continue;
        try {
          const { windowId } = await cdp.send("Browser.getWindowForTarget", { targetId: target.targetId });
          if (!windowId || seen.has(windowId)) continue;
          seen.add(windowId);
          try {
            await cdp.send("Browser.setWindowBounds", {
              windowId,
              bounds: { windowState: "minimized" },
            });
          } catch {
            await cdp.send("Browser.setWindowBounds", {
              windowId,
              bounds: {
                left: -32000,
                top: -32000,
                width: Math.max(400, viewport?.width || 580),
                height: Math.max(600, viewport?.height || 900),
                windowState: "normal",
              },
            });
          }
        } catch {}
      }
    } catch {}
  };

  await minimizeOnce();
  try {
    cdp.on("Target.targetCreated", () => {
      minimizeOnce().catch(() => {});
    });
  } catch {}
  for (const delay of [80, 250, 800, 2000]) {
    setTimeout(() => { minimizeOnce().catch(() => {}); }, delay);
  }
}

export async function isChromeProfileErrorPage(page, context = null) {
  const pages = context?.pages?.()?.length ? context.pages() : (page ? [page] : []);
  for (const item of pages) {
    if (item?.isClosed?.()) continue;
    try {
      const hit = await item.evaluate(() => {
        const text = String(document.body?.innerText || document.title || "");
        return /Не удалось открыть профиль|Failed to open profile|Some features may be unavailable/i.test(text);
      });
      if (hit) return true;
    } catch {}
  }
  return false;
}

export async function applyChatGPTStealth(context) {
  try {
    await context.addInitScript(() => {
      // 1. Delete webdriver from prototype
      try {
        const proto = Object.getPrototypeOf(navigator);
        delete proto.webdriver;
      } catch {}

      // 2. Add chrome object if missing
      try {
        if (!window.chrome) {
          window.chrome = {
            app: { isInstalled: false, InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" }, RunningState: { CANNOT_RUN: "cannot_run", CAN_RUN: "can_run", RUNNING: "running" } },
            runtime: { OnInstalledReason: { CHROME_UPDATE: "chrome_update", INSTALL: "install", SHARED_MODULE_UPDATE: "shared_module_update", UPDATE: "update" }, OnRestartRequiredReason: { APP_UPDATE: "app_update", OS_UPDATE: "os_update", PERIODIC: "periodic" }, PlatformArch: { ARM: "arm", ARM64: "arm64", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" }, PlatformNaclArch: { ARM: "arm", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" }, PlatformOs: { ANDROID: "android", CROS: "cros", LINUX: "linux", MAC: "mac", OPENBSD: "openbsd", WIN: "win" }, RequestUpdateCheckStatus: { NO_UPDATE: "no_update", THROTTLED: "throttled", UPDATE_AVAILABLE: "update_available" } }
          };
        }
      } catch {}

      // 3. Mock permissions query
      try {
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters);
      } catch {}
    });
  } catch {}
}

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
    const { detectCloudflareChallenge } = await import("./cloudflare-challenge.mjs");
    const state = await detectCloudflareChallenge(page);
    return state.challenge;
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

// Убиваем «зависшие» Chrome на этом user-data-dir (в т.ч. detached после прошлого запуска).
export function killStaleChromeForProfile(profileDir) {
  let killed = false;
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
    const dir = String(profileDir);
    const patterns = [
      `--user-data-dir=${dir}`,
      `--user-data-dir=${dir}/`,
      dir,
    ];
    for (const pattern of patterns) {
      const term = spawnSync("pkill", ["-f", pattern], {
        stdio: "ignore",
        timeout: 10_000,
      });
      if (term.status === 0) killed = true;
      const kill = spawnSync("pkill", ["-9", "-f", pattern], {
        stdio: "ignore",
        timeout: 10_000,
      });
      if (kill.status === 0) killed = true;
    }
    return killed;
  } catch {
    return killed;
  }
}

export function cleanupChromeProfileForLaunch(profileDir, { clearCookies = false } = {}) {
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
  {
    initialUrl = CHATGPT_BASE_URL,
    clearCookies = false,
    offscreen = false,
    headless = false,
    skipKillStale = false,
    embedded = false,
    windowSize = { width: 580, height: 900 },
  } = {},
) {
  const chromeBinary = findChromeBinary();
  if (!chromeBinary) {
    return null;
  }

  return withChatGPTProfileLock(async () => {
  if (!skipKillStale) {
    await prepareChromeProfileForLaunchInternal(profileDir, { clearCookies });
  } else {
    cleanupChromeProfileForLaunch(profileDir, { clearCookies });
  }
  const port = await reserveLocalPort();
  const w = Math.max(400, Number(windowSize.width) || 580);
  const h = Math.max(600, Number(windowSize.height) || 900);
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=ChromeWhatsNewUI,ProfilePickerOnStartup",
  ];
  if (headless) {
    args.push("--headless=new", "--disable-gpu");
  } else if (offscreen || embedded) {
    args.push(
      "--start-minimized",
      "--window-position=-32000,-32000",
      `--window-size=${w},${h}`,
    );
  } else {
    args.push("--new-window");
  }
  args.push(initialUrl || CHATGPT_BASE_URL);
  let chromeProcess = null;
  let browser = null;
  try {
    // embedded: дочерний процесс — закрывается вместе с ai-free, без зомби-профиля.
    chromeProcess = spawn(chromeBinary, args, {
      detached: !embedded,
      stdio: "ignore",
    });
    if (!embedded) {
      chromeProcess.unref();
    }
    browser = await connectOverCDP(chromium, port);
    if (!headless && (offscreen || embedded)) {
      await minimizeEmbeddedChromeWindows(browser, { width: w, height: h });
    }
  } catch (error) {
    try { chromeProcess?.kill("SIGTERM"); } catch {}
    try { if (chromeProcess?.pid && !embedded) process.kill(-chromeProcess.pid, "SIGTERM"); } catch {}
    try { if (chromeProcess?.pid && embedded) chromeProcess.kill("SIGKILL"); } catch {}
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
  if (!headless && (offscreen || embedded)) {
    await minimizeEmbeddedChromeWindows(browser, { width: w, height: h });
  }
  await sleep(400);
  if (await isChromeProfileErrorPage(page, context)) {
    try {
      const cdp = await browser.newBrowserCDPSession();
      await cdp.send("Browser.close");
    } catch {}
    try { await browser.close(); } catch {}
    try { chromeProcess?.kill("SIGKILL"); } catch {}
    return null;
  }
  if (initialUrl && !page.url().includes("chatgpt.com") && page.url() !== initialUrl) {
    await page.goto(initialUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  }
  return {
    context,
    page,
    chromeProcess,
    close: async () => {
      try {
        const cdp = await browser.newBrowserCDPSession();
        await cdp.send("Browser.close");
      } catch {}
      try { await browser.close(); } catch {}
      try { chromeProcess?.kill("SIGTERM"); } catch {}
      if (!embedded && chromeProcess?.pid) {
        try { process.kill(-chromeProcess.pid, "SIGTERM"); } catch {}
      }
    },
    mode: embedded ? "chrome-cdp-embedded" : "chrome-cdp",
  };
  });
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
  const embedUi = process.env.CHATGPT_EMBED_IN_UI === "1";
  const launch = getChatGPTBrowserLaunchOptions();
  const { resetChatGPTBrowserProxy } = await import("./browser-proxy.mjs");
  resetChatGPTBrowserProxy();
  await new Promise((resolve) => setTimeout(resolve, 1200));

  if (embedUi) {
    console.log("🔓 ChatGPT: откройте 🧠 → Браузер → ChatGPT в окне ai-free.");
    console.log("   Войдите вручную в экране панели — сессия сохранится в ~/.chatgpt-cli/auth.json");
    const { warmChatGPTInAppBrowser } = await import("../../window-app/chatgpt-live-panel.mjs");
    await warmChatGPTInAppBrowser();
    const { getChatGPTBrowserProxy } = await import("./browser-proxy.mjs");
    const proxy = await getChatGPTBrowserProxy();
    const page = proxy.getPage();
    const context = proxy.getContext();

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

        interval = setInterval(captureCurrentSession, 4000);
        captureCurrentSession();
      });
    } catch (error) {
      throw error;
    }

    writeChatGPTAuth(authFile, {
      cookies: captured.cookies,
      accessToken: captured.accessToken,
      sessionToken: captured.sessionToken,
      profileDir,
      userAgent: captured.userAgent,
    });
    console.log("✅ ChatGPT: сессия сохранена.");
    return captured;
  }

  repairChatGPTBrowserProfile(profileDir);

  const { getChatGPTChromium } = await import("./engine.mjs");
  const chromium = await getChatGPTChromium();
  let session;
  if (launch.useExternalChrome) {
    session = await launchNormalChromeForChatGPT(chromium, profileDir, {
      initialUrl: "about:blank",
      clearCookies: true,
      skipKillStale: true,
      headless: launch.headless,
      offscreen: launch.offscreen,
    })
      || await launchPlaywrightChromeForLogin(chromium, profileDir);
  } else {
    const { attachInAppBrowserSession } = await import("../../window-app/in-app-browser.mjs");
    session = await attachInAppBrowserSession("chatgpt");
  }
  const { context, page } = session;

  await clearBrowserCookiesViaCdp(page, context);
  await openChatGPTForLogin(page, context);

  if (embedUi) {
    console.log("🔓 ChatGPT: войдите через 🧠 → Браузер в окне ai-free (отдельное окно Chrome не откроется).");
  } else {
    console.log("🔓 Открываем окно ChatGPT (chatgpt.com).");
    console.log("   • Пройдите Cloudflare вручную, если появится чекбокс.");
    console.log("   • Затем залогиньтесь вручную (Google, email, etc.).");
    console.log("   • Окно останется открытым — через него идут все запросы к ChatGPT.");
  }
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
  console.log(embedUi
    ? "✅ Успешный вход в ChatGPT! Сессия сохранена (фоновый Chrome, панель 🧠 → Браузер)."
    : "✅ Успешный вход в ChatGPT! Окно браузера остаётся открытым.");
  return captured;
}
