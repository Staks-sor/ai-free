// Singleton-менеджер обновления auth. При параллельных запросах (например,
// в /window несколько одновременных API-вызовов) гарантирует, что окно re-login
// открывается ОДИН раз — остальные ждут ту же promise.
//
// Логика: silent headless из profile → если не помог → видимое окно re-login
// с предварительной очисткой cookies сессии.

import fs from "node:fs";
import { DEFAULT_BROWSER_PROFILE } from "../config.mjs";
import {
  clearProfileSession,
  loginAndSaveAuth,
  refreshAuthFromProfile,
} from "../browser/login.mjs";

export class AuthManager {
  constructor({ authFile, debug = false, autoVisible = true }) {
    this.authFile = authFile;
    this.debug = debug;
    this.autoVisible = autoVisible;
    this._inFlight = null;
    this._consecutiveFailures = 0;
  }

  async refresh(options = {}) {
    if (this._inFlight) return this._inFlight;
    this._inFlight = this._doRefresh(options).finally(() => {
      this._inFlight = null;
    });
    return this._inFlight;
  }

  // forceVisible=true — пропустить silent и сразу открыть видимое окно.
  // Используется на втором retry в _withReauth, когда silent уже не помог.
  async _doRefresh({ forceVisible = false } = {}) {
    if (!forceVisible && fs.existsSync(this.authFile)) {
      try {
        if (this.debug) console.error("[auth] trying silent (headless) refresh from saved profile...");
        const auth = await refreshAuthFromProfile(this.authFile);
        this._consecutiveFailures = 0;
        console.log("🔄 Auth refreshed silently from saved profile.");
        return auth;
      } catch (error) {
        if (this.debug) console.error(`[auth] silent refresh failed: ${error.message}`);
      }
    }

    if (!this.autoVisible) {
      throw new Error("Auth invalid and visible re-login disabled. Run `npm run login`.");
    }

    this._consecutiveFailures += 1;
    if (this._consecutiveFailures > 3) {
      throw new Error("Too many failed re-login attempts in a row. Aborting to avoid loop.");
    }

    console.log("\n🔒 DeepSeek session expired. Clearing stale session and opening login window...");
    try {
      await clearProfileSession(DEFAULT_BROWSER_PROFILE);
    } catch (error) {
      if (this.debug) console.error(`[auth] could not clear profile session (continuing): ${error.message}`);
    }

    const auth = await loginAndSaveAuth(this.authFile);
    this._consecutiveFailures = 0;
    console.log("✅ Re-login completed. Resuming...");
    return auth;
  }
}
