import {
  GOOGLE_AI_AUTH_FILE,
  GOOGLE_AI_BASE_URL,
  GOOGLE_AI_CAMOUFOX_PROFILE,
  GOOGLE_AI_FINGERPRINT_STATE,
  GOOGLE_AI_STORAGE_STATE,
} from "./config.mjs";
import { writeGoogleAIAuth } from "./auth-files.mjs";
import { saveGoogleAIStorageState } from "./storage-state.mjs";
import { launchCamoufoxSession } from "../../browser/camoufox-runtime.mjs";
import { readGoogleAIPageState } from "./browser-proxy.mjs";

const LOGIN_TIMEOUT_MS = 10 * 60_000;

export async function loginGoogleAIAndSave(authFile = GOOGLE_AI_AUTH_FILE, {
  storageStatePath = GOOGLE_AI_STORAGE_STATE,
  profileDir = GOOGLE_AI_CAMOUFOX_PROFILE,
  fingerprintStatePath = GOOGLE_AI_FINGERPRINT_STATE,
  launchSession = launchCamoufoxSession,
} = {}) {
  const session = await launchSession({
    headless: false,
    viewport: { width: 1280, height: 900 },
    storageStatePath,
    profileDir,
    fingerprintStatePath,
  });
  const { context, page } = session;
  let accountLabel = "";

  try {
    await page.goto(GOOGLE_AI_BASE_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.bringToFront();
    console.log("🔓 Google AI login window открыто.");
    console.log("   • Войдите в личный Google-аккаунт и откройте режим ИИ.");
    console.log("   • Окно закроется автоматически после подтверждения входа.");

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await page.waitForFunction(() => [...document.querySelectorAll('a, button')]
        .some((item) => /Аккаунт Google|Google Account/i.test(item.getAttribute("aria-label") || "")),
      null, { timeout: Math.max(1, deadline - Date.now()), polling: 500 });
      await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForTimeout(3_000);
      const state = await page.evaluate(() => {
        const hasComposer = [...document.querySelectorAll('textarea, [role="textbox"]')]
          .some((item) => /Задайте вопрос|Ask anything|Ask a question/i.test(
            `${item.getAttribute("aria-label") || ""} ${item.getAttribute("placeholder") || ""}`,
          ));
        const accountLabel = [...document.querySelectorAll('a, button')]
          .find((item) => /Аккаунт Google|Google Account/i.test(item.getAttribute("aria-label") || ""))
          ?.getAttribute("aria-label") || "";
        const hasSignIn = [...document.querySelectorAll('a, button')]
          .some((item) => /^(Войти|Sign in)$/i.test((item.getAttribute("aria-label") || item.textContent || "").trim()));
        return { hasComposer, hasAccount: Boolean(accountLabel), hasSignIn, accountLabel };
      });
      if (!state.hasComposer || !state.hasAccount || state.hasSignIn) continue;
      await saveGoogleAIStorageState(context, storageStatePath);
      accountLabel = state.accountLabel;
      break;
    }
    if (!accountLabel) throw new Error("Google AI: не удалось подтвердить вход после перезагрузки страницы.");
  } finally {
    await session.close().catch(() => {});
  }
  const check = await launchSession({ headless: true, viewport: { width: 1280, height: 900 }, storageStatePath, profileDir, fingerprintStatePath });
  try {
    await check.page.goto(GOOGLE_AI_BASE_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
    let state;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      state = await readGoogleAIPageState(check.page);
      if (state.hasAccount && state.hasComposer && !state.hasSignIn) break;
      await check.page.waitForTimeout(1_000);
    }
    if (!state.hasAccount || !state.hasComposer || state.hasSignIn) {
      throw new Error("Google AI: вход не сохранился в скрытом Camoufox. Авторизация не подтверждена.");
    }
  } finally {
    await check.close().catch(() => {});
  }
  writeGoogleAIAuth(authFile, { profileDir, storageStatePath, accountLabel });
  console.log(`✅ Google AI login successful.\n💾 Saved auth to ${authFile}`);
  return { signedIn: true, storageStatePath, accountLabel };
}
