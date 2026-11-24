import fs from "node:fs";
import path from "node:path";
import {
  GOOGLE_AI_BROWSER_PROFILE,
  GOOGLE_AI_STORAGE_STATE,
} from "./config.mjs";

export function isGoogleAIStorageStateUsable(file = GOOGLE_AI_STORAGE_STATE) {
  if (!fs.existsSync(file)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(state?.cookies) && state.cookies.length > 0;
  } catch {
    return false;
  }
}

export async function saveGoogleAIStorageState(context, file = GOOGLE_AI_STORAGE_STATE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await context.storageState({ path: file });
  try { fs.chmodSync(file, 0o600); } catch {}
  return file;
}

export async function ensureGoogleAIStorageState(
  file = GOOGLE_AI_STORAGE_STATE,
  { launchContext = null } = {},
) {
  if (isGoogleAIStorageStateUsable(file)) return file;

  let context = null;
  try {
    if (launchContext) {
      context = await launchContext();
    } else {
      const { ensureBrowserBinaries } = await import("../../browser/ensure-binaries.mjs");
      const browserReady = await ensureBrowserBinaries();
      if (!browserReady.ok) throw new Error(browserReady.error || "Chromium browser binaries are not installed.");
      const { getChatGPTChromium } = await import("../chatgpt/engine.mjs");
      const { launchPersistentDeepSeekContext } = await import("../../browser/launch.mjs");
      const chromium = await getChatGPTChromium();
      context = await launchPersistentDeepSeekContext(chromium, GOOGLE_AI_BROWSER_PROFILE, true);
    }
    await saveGoogleAIStorageState(context, file);
  } finally {
    await context?.close?.().catch(() => {});
  }

  if (!isGoogleAIStorageStateUsable(file)) {
    throw new Error("Не удалось перенести сессию Google AI. Повторите авторизацию Google AI.");
  }
  return file;
}
