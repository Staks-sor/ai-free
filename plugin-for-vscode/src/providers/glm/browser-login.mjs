import {
  GLM_AUTH_FILE,
  GLM_BASE_URL,
  GLM_BROWSER_PROFILE,
  GLM_STORAGE_STATE,
} from "./config.mjs";
import {
  hasGLMAuthCookie,
  isGLMLoginConfirmed,
  isGLMUserToken,
  writeGLMAuth,
} from "./auth-files.mjs";
import { saveGLMStorageState } from "./storage-state.mjs";
import {
  inspectGLMModelMenu,
  normalizeGLMAnswer,
  submitGLMPrompt,
} from "./browser-proxy.mjs";
import { launchPersistentDeepSeekContext } from "../../browser/launch.mjs";

const LOGIN_TIMEOUT_MS = 10 * 60_000;
const SESSION_CHECK_PROMPT = "Ответь только: GLM OK";

export function isGLMSessionCheckComplete({
  answer = "",
  previousText = "",
  hasVerification = false,
} = {}) {
  return !hasVerification && Boolean(answer) && answer !== previousText;
}

export function resolveGLMLoginOptions(options = {}, env = process.env) {
  return {
    keepOpen: options.keepOpen ?? env.GLM_KEEP_LOGIN_OPEN === "1",
  };
}

export async function loginGLMAndSave(authFile = GLM_AUTH_FILE, options = {}) {
  const { keepOpen } = resolveGLMLoginOptions(options);
  const profileDir = options.profileDir || GLM_BROWSER_PROFILE;
  const storageStatePath = options.storageStatePath || GLM_STORAGE_STATE;
  const { ensureBrowserBinaries } = await import("../../browser/ensure-binaries.mjs");
  const browserReady = await ensureBrowserBinaries();
  if (!browserReady.ok) throw new Error(browserReady.error || "Chromium browser binaries are not installed.");

  const { getChatGPTChromium } = await import("../chatgpt/engine.mjs");
  const chromium = await getChatGPTChromium();
  const context = await launchPersistentDeepSeekContext(chromium, profileDir, false);
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto(GLM_BASE_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
    console.log("🔓 GLM login window открыто (chat.z.ai).");
    console.log("   • Войдите в личный аккаунт Z.ai и завершите защитную проверку, если она появится.");
    console.log(keepOpen
      ? "   • Диагностический режим: окно останется открытым до ручного закрытия."
      : "   • Окно закроется автоматически после подтверждения активной сессии.");

    await waitForGLMLogin(page, context);
    console.log("   • Вход подтверждён. Проверяю, что браузерная сессия умеет получать ответы.");
    console.log("   • Если Z.ai покажет ползунок проверки, завершите его один раз в этом окне.");
    await verifyGLMBrowserSession(page);

    const accountLabel = await page.evaluate(() => {
      const account = [...document.querySelectorAll("button, [aria-label]")]
        .find((item) => /account|profile|аккаунт|профиль/i.test(
          `${item.getAttribute("aria-label") || ""} ${item.getAttribute("title") || ""}`,
        ));
      return account?.getAttribute("aria-label") || account?.getAttribute("title") || "Z.ai account";
    });
    await saveGLMStorageState(context, storageStatePath);
    writeGLMAuth(authFile, { profileDir, accountLabel });
    console.log(`✅ GLM login successful.\n💾 Saved auth to ${authFile}`);
    if (keepOpen) {
      const models = await inspectGLMModelMenu(page).catch(() => null);
      if (models) {
        console.log(`🔎 Текущая модель Z.ai: ${models.currentLabel || "не определена"}`);
        console.log(`🔎 Найденные варианты: ${models.availableLabels.join(" | ") || "не найдены"}`);
      }
      console.log("🔎 Окно GLM оставлено открытым. Закройте его вручную после проверки чата и моделей.");
      await page.waitForEvent("close", { timeout: 0 });
    }
    return { signedIn: true, profileDir, accountLabel };
  } finally {
    await context.close().catch(() => {});
  }
}

export async function verifyGLMBrowserSession(page, { timeoutMs = LOGIN_TIMEOUT_MS } = {}) {
  const previousText = await readLatestAssistantText(page);
  await submitGLMPrompt(page, SESSION_CHECK_PROMPT);

  const deadline = Date.now() + timeoutMs;
  let verificationReported = false;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => ({
      hasVerification: /security verification|drag the slider|验证码|проверку безопасности/i
        .test(document.body?.innerText || ""),
      hasSignIn: [...document.querySelectorAll("button, a")]
        .some((item) => /^(Sign in|Log in|Войти)$/i.test(
          (item.textContent || item.getAttribute("aria-label") || "").trim(),
        )),
    }));
    if (state.hasSignIn) {
      throw new Error("GLM login was lost before the browser session check completed.");
    }
    if (state.hasVerification && !verificationReported) {
      console.log("⚠️ Z.ai запросил защитную проверку. Завершите ползунок в открытом окне.");
      verificationReported = true;
    }
    const answer = await readLatestAssistantText(page);
    if (isGLMSessionCheckComplete({
      answer,
      previousText,
      hasVerification: state.hasVerification,
    })) return answer;
    await page.waitForTimeout(500);
  }
  throw new Error("GLM login timed out before Z.ai returned the browser session check response.");
}

async function readLatestAssistantText(page) {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll(
      '#messages-container .assistant-message, #messages-container .chat-assistant, #messages-container [id^="message-"]',
    )].filter((element) => !element.classList.contains("user-message")
      && !element.id.endsWith("-start")
      && !element.closest(".user-message"));
    const content = nodes.at(-1)?.querySelector(".markdown-prose") || nodes.at(-1);
    return (content?.innerText || content?.textContent || "").trim();
  }).then(normalizeGLMAnswer);
}

async function waitForGLMLogin(page, context) {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const pageState = await page.evaluate(() => ({
      hasComposer: Boolean(document.querySelector("#chat-input")),
      authToken: localStorage.getItem("token") || localStorage.getItem("access_token") || "",
    }));
    const cookies = await context.cookies(GLM_BASE_URL);
    if (isGLMLoginConfirmed({
      ...pageState,
      hasAuthToken: isGLMUserToken(pageState.authToken),
      hasAuthCookie: hasGLMAuthCookie(cookies),
    })) return;
    await page.waitForTimeout(500);
  }
  throw new Error("GLM login timed out before Z.ai confirmed the authenticated session.");
}
