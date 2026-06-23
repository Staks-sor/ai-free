// Менеджер сессии Qwen — по аналогии с src/auth/manager.mjs (DeepSeek).
//
// Цепочка при протухшей сессии:
//   1. Тихий refresh из persistent-профиля (если не skipSilent)
//   2. Видимое окно login в ai-free (то же, что npm run login-qwen)
//
// После любого успешного refresh сбрасываем browser-proxy, чтобы подхватил свежие куки.

import fs from "node:fs";
import { QWEN_AUTH_FILE, QWEN_BROWSER_PROFILE } from "./config.mjs";
import { readQwenAuth } from "./auth-files.mjs";
import { loginQwenAndSave, refreshQwenAuthFromProfile } from "./browser-login.mjs";
import { resetQwenBrowserProxy } from "./browser-proxy.mjs";
import { isQwenSessionExpiredError, isQwenSessionExpiredText, createQwenReloginFailedError } from "./session-errors.mjs";

export class QwenAuthManager {
  constructor({ authFile = QWEN_AUTH_FILE, debug = false, autoVisible = true } = {}) {
    this.authFile = authFile;
    this.debug = debug;
    this.autoVisible = autoVisible;
    this._inFlight = null;
    this._consecutiveFailures = 0;
    this._lastReloginAt = 0;
    this._lastReloginToken = "";
  }

  async refresh({ forceVisible = false, skipSilent = false, clearSession = false, onReloginStart = null } = {}) {
    if (this._inFlight) return this._inFlight;
    this._inFlight = this._doRefresh({ forceVisible, skipSilent, clearSession, onReloginStart }).finally(() => {
      this._inFlight = null;
    });
    return this._inFlight;
  }

  async _doRefresh({ forceVisible = false, skipSilent = false, clearSession = false, onReloginStart = null } = {}) {
    if (!forceVisible && !skipSilent && fs.existsSync(this.authFile)) {
      try {
        if (this.debug) console.error("[qwen-auth] trying silent refresh from profile…");
        const auth = await refreshQwenAuthFromProfile(this.authFile);
        await resetQwenBrowserProxy();
        this._consecutiveFailures = 0;
        console.log("🔄 Qwen auth refreshed silently from saved profile.");
        return auth;
      } catch (error) {
        if (this.debug) console.error(`[qwen-auth] silent refresh failed: ${error.message}`);
      }
    }

    if (!this.autoVisible) {
      throw new Error(
        "Qwen session invalid and visible re-login disabled. Подключи Qwen в окне ai-free (кнопка у провайдера).",
      );
    }

    this._consecutiveFailures += 1;
    if (this._consecutiveFailures > 3) {
      throw new Error("Too many failed Qwen re-login attempts. Aborting to avoid loop.");
    }

    const now = Date.now();
    const existing = readQwenAuth(this.authFile);
    if (
      forceVisible
      && this._lastReloginAt
      && existing?.token
      && existing.token === this._lastReloginToken
      && now - this._lastReloginAt < 10 * 60 * 1000
    ) {
      throw createQwenReloginFailedError({
        details: "Недавний вход не помог. Скорее всего, Qwen блокирует запрос (anti-bot), а не сессия.",
      });
    }

    console.log("\n🔒 Qwen session expired or missing. Opening login window (chat.qwen.ai)…");
    if (typeof onReloginStart === "function") {
      try { onReloginStart(); } catch {}
    }
    const previous = existing;
    const auth = await loginQwenAndSave(this.authFile, { clearSession });
    if (clearSession && previous?.token && auth.token === previous.token) {
      throw createQwenReloginFailedError({
        details: "Вход не обновил JWT — возможно, окно закрыли до завершения авторизации.",
      });
    }
    this._lastReloginAt = Date.now();
    this._lastReloginToken = auth.token || "";
    await resetQwenBrowserProxy();
    this._consecutiveFailures = 0;
    console.log("✅ Qwen re-login completed.");
    return auth;
  }
}

let defaultManager = null;

export function getQwenAuthManager(options = {}) {
  if (!defaultManager) {
    defaultManager = new QwenAuthManager({
      debug: Boolean(process.env.DEEPSEEK_DEBUG_QWEN),
      autoVisible: options.autoVisible !== false,
      ...options,
    });
  }
  return defaultManager;
}

export function isQwenAuthConfigured() {
  const auth = readQwenAuth(QWEN_AUTH_FILE);
  return Boolean(auth?.token);
}

export function isQwenAuthError(error) {
  if (!error) return false;
  if (error.isQwenReloginFailed) return false;
  if (isQwenSessionExpiredError(error)) return true;
  if (error.isAuthError) return true;
  const msg = String(error.message || "");
  const status = error.status || error.httpStatus;
  if (status === 401 || status === 403) return true;
  if (isQwenSessionExpiredText(msg)) return true;
  return /(?:^|\s)(401|403)(?:\s|$)/.test(msg)
    || /unauthorized|not.?logged|login required|please log in|sign.?in|auth(?:entication)? failed|сессия qwen устарела/i.test(msg);
}
