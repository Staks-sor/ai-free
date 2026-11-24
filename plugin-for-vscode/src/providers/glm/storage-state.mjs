import fs from "node:fs";
import path from "node:path";
import {
  GLM_BROWSER_PROFILE,
  GLM_STORAGE_STATE,
} from "./config.mjs";
import { hasGLMAuthCookie, isGLMUserToken } from "./auth-files.mjs";

export function isGLMStorageStateUsable(file = GLM_STORAGE_STATE) {
  if (!fs.existsSync(file)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    const hasOriginToken = Array.isArray(state?.origins)
      && state.origins.some((origin) => /chat\.z\.ai$/i.test(new URL(origin.origin).hostname)
        && Array.isArray(origin?.localStorage)
        && origin.localStorage.some((entry) => /^(?:token|access_token)$/i.test(String(entry?.name || ""))
          && isGLMUserToken(entry?.value)));
    return hasGLMAuthCookie(state?.cookies) || hasOriginToken;
  } catch {
    return false;
  }
}

export async function saveGLMStorageState(context, file = GLM_STORAGE_STATE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await context.storageState({ path: file });
  try { fs.chmodSync(file, 0o600); } catch {}
  return file;
}

export async function ensureGLMStorageState(
  file = GLM_STORAGE_STATE,
  { launchContext = null } = {},
) {
  if (isGLMStorageStateUsable(file)) return file;

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
      context = await launchPersistentDeepSeekContext(chromium, GLM_BROWSER_PROFILE, true);
    }
    await saveGLMStorageState(context, file);
  } finally {
    await context?.close?.().catch(() => {});
  }

  if (!isGLMStorageStateUsable(file)) {
    throw new Error("Не удалось перенести сессию GLM. Повторите авторизацию Z.ai.");
  }
  return file;
}
