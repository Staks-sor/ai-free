// Менеджер сессии Qwen — по аналогии с src/auth/manager.mjs (DeepSeek).
//
// Цепочка при протухшей сессии:
//   1. Тихий refresh из persistent-профиля (если не skipSilent)
//   2. Видимое окно login в ai-free (то же, что npm run login-qwen)
//
// После любого успешного refresh сбрасываем browser-proxy, чтобы подхватил свежие куки.
//
// Proactive refresh: фоновый таймер каждые QWEN_PROACTIVE_REFRESH_INTERVAL_MS
// (по умолчанию 60 секунд) проверяет exp текущего токена. Если до протухания
// осталось меньше QWEN_REFRESH_SKEW_SEC секунд (по умолчанию 90) — дёргает
// silent refresh, не дожидаясь 401 от API.
//
// ВАЖНО: интервал ДОЛЖЕН быть существенно меньше TTL токена. У Qwen сейчас
// TTL ≈ 15 минут (900с). Если поставить интервал 10 минут — возможна дыра:
//   00:00  получили JWT (exp = 15:00)
//   10:00  tick: осталось 5 мин, >90с, skip
//   20:00  tick: JWT уже протух 5 минут назад
// Поэтому дефолт — 60 секунд. Это даёт ~14 возможностей поймать протухание
// до того, как оно случится.

import fs from "node:fs";
import { QWEN_AUTH_FILE, QWEN_BROWSER_PROFILE } from "./config.mjs";
import { readQwenAuth } from "./auth-files.mjs";
import { loginQwenAndSave, refreshQwenAuthFromProfile } from "./browser-login.mjs";
import { resetQwenBrowserProxy } from "./browser-proxy.mjs";
import { isQwenSessionExpiredError, isQwenSessionExpiredText, createQwenReloginFailedError } from "./session-errors.mjs";

const QWEN_PROACTIVE_REFRESH_INTERVAL_MS = Number(
  process.env.QWEN_PROACTIVE_REFRESH_INTERVAL_MS || 60 * 1000,
);
const QWEN_REFRESH_SKEW_SEC = Number(process.env.QWEN_REFRESH_SKEW_SEC || 90);

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

function isQwenTokenExpired(token, skewSec = QWEN_REFRESH_SKEW_SEC) {
  if (!token) return true;
  const exp = decodeJwtExp(token);
  if (!exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return exp - now < skewSec;
}

export class QwenAuthManager {
  constructor({ authFile = QWEN_AUTH_FILE, debug = false, autoVisible = true } = {}) {
    this.authFile = authFile;
    this.debug = debug;
    this.autoVisible = autoVisible;
    this._inFlight = null;
    this._consecutiveFailures = 0;
    this._lastReloginAt = 0;
    this._lastReloginToken = "";
    this._proactiveTimer = null;
    this._proactiveInFlight = null;
    // Список клиентов, которых надо уведомлять об обновлении токена.
    // QwenChatClient создаётся ОДИН раз (singleton в api/openai-handler.mjs),
    // и при silent refresh его внутреннее состояние this.token/this.cookieHeader
    // становится устаревшим. Если не вызвать setAuth() — клиент продолжит
    // использовать протухший токен, и Qwen API вернёт 401, несмотря на то,
    // что auth.json уже обновлён.
    this._clients = new Set();
  }

  // Подписать клиент на уведомления об обновлении токена.
  // Клиент должен иметь метод setAuth({ token, cookieHeader }).
  registerClient(client) {
    if (client && typeof client.setAuth === "function") {
      this._clients.add(client);
    }
  }

  // Отписать клиент.
  unregisterClient(client) {
    this._clients.delete(client);
  }

  // Внутренний метод — уведомить всех подписанных клиентов о новом токене.
  _notifyClients(auth) {
    if (!auth?.token) return;
    for (const client of this._clients) {
      try {
        client.setAuth({ token: auth.token, cookieHeader: auth.cookieHeader });
      } catch (err) {
        if (this.debug) console.error(`[qwen-auth] failed to update client: ${err.message}`);
      }
    }
  }

  async refresh({ forceVisible = false, skipSilent = false, clearSession = false, onReloginStart = null, allowVisible = true, force = false } = {}) {
    if (this._inFlight) return this._inFlight;
    this._inFlight = this._doRefresh({ forceVisible, skipSilent, clearSession, onReloginStart, allowVisible, force }).finally(() => {
      this._inFlight = null;
    });
    return this._inFlight;
  }

  async _doRefresh({ forceVisible = false, skipSilent = false, clearSession = false, onReloginStart = null, allowVisible = true, force = false } = {}) {
    if (!forceVisible && !skipSilent && fs.existsSync(this.authFile)) {
      try {
        if (this.debug) console.error("[qwen-auth] trying silent refresh from profile…");
        const auth = await refreshQwenAuthFromProfile(this.authFile, { requireFreshToken: true, force });
        // НЕ сбрасываем browser-proxy после успешного silent refresh.
        // reloadAndCaptureFreshToken() уже обновил localStorage["token"]
        // в существующем Chromium — reset не нужен и вреден:
        //   1. Закрытие Chromium занимает время и тормозит следующий запрос.
        //   2. Сборщик мусора при закрытии может убить proactive timer (setInterval).
        //   3. Persistent-профиль может остаться в подвешенном состоянии.
        this._consecutiveFailures = 0;
        console.log("🔄 Qwen auth refreshed silently from saved profile.");
        // ВАЖНО: обновляем токен во всех уже созданных QwenChatClient'ах.
        // Иначе singleton-клиент продолжит использовать старый токен и получит 401,
        // несмотря на то, что auth.json уже обновлён.
        this._notifyClients(auth);
        return auth;
      } catch (error) {
        if (this.debug) console.error(`[qwen-auth] silent refresh failed: ${error.message}`);
      }
    }

    // Если visible re-login запрещён (например, вызов из proactive timer) —
    // кидаем ошибку, не открывая окно. Visible re-login откроется только при
    // явном пользовательском запросе, который получил 401.
    if (!allowVisible || !this.autoVisible) {
      throw new Error(
        "Qwen silent refresh failed and visible re-login is not allowed in this context. " +
        "Visible re-login will be triggered by the next user request that returns 401.",
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
    // После visible re-login тоже обновляем токен во всех подписанных клиентах.
    this._notifyClients(auth);
    return auth;
  }

  // Запустить фоновый proactive refresh. Безопасно вызвать несколько раз —
  // таймер не дублируется. Вызывается автоматически при первом getQwenAuthManager().
  startProactiveRefresh({ intervalMs = QWEN_PROACTIVE_REFRESH_INTERVAL_MS } = {}) {
    if (this._proactiveTimer) return;
    if (this.debug) {
      console.log(`[qwen-auth] proactive refresh timer started, interval=${Math.round(intervalMs / 1000)}s`);
    }

    // Используем РЕКУРСИВНЫЙ setTimeout вместо setInterval.
    //
    // setInterval(async fn) на Windows в --api режиме нестабилен:
    // после 2 тиков он "останавливается" без видимой причины. Возможно,
    // из-за unhandled promise rejection внутри async callback, или из-за
    // особенностей Node.js event loop с async functions в setInterval.
    //
    // Рекурсивный setTimeout надёжнее:
    //   • Каждый тик планируется только после завершения предыдущего
    //   • Если в тике падает ошибка — она попадает в catch, но следующий
    //     тик всё равно планируется
    //   • Если предыдущий тик занял дольше intervalMs — следующий начнётся
    //     сразу, без накопления очереди
    const scheduleNext = () => {
      this._proactiveTimer = setTimeout(async () => {
        try {
          await this._doProactiveTick();
        } catch (err) {
          console.warn(`[qwen-auth] proactive tick crashed: ${err.message}`);
        } finally {
          this._proactiveInFlight = null;
          // Планируем следующий тик ТОЛЬКО если timer не был остановлен.
          if (this._proactiveTimer !== null) {
            scheduleNext();
          }
        }
      }, intervalMs);
    };
    scheduleNext();
  }

  // Внутренний метод — один proactive tick.
  // Вынесен отдельно, чтобы его можно было дёргать и вручную (для тестов).
  async _doProactiveTick() {
    if (this._proactiveInFlight) {
      if (this.debug) console.log("[qwen-auth] proactive tick: previous still in flight, skip");
      return;
    }
    this._proactiveInFlight = (async () => {
      // Если auth.json ещё не существует — refresh не нужен (юзер ещё не логинился).
      if (!fs.existsSync(this.authFile)) {
        if (this.debug) console.log("[qwen-auth] proactive tick: auth.json not found, skip");
        return;
      }

      const auth = readQwenAuth(this.authFile);
      // Если токен ещё живой (>skew секунд до протухания) — refresh не нужен.
      if (auth?.token && !isQwenTokenExpired(auth.token, QWEN_REFRESH_SKEW_SEC)) {
        if (this.debug) {
          const exp = decodeJwtExp(auth.token);
          const left = exp - Math.floor(Date.now() / 1000);
          console.log(`[qwen-auth] proactive tick: token still valid (${left}s left), skip`);
        }
        return;
      }

      if (this.debug) console.log("[qwen-auth] proactive tick: token near expiry, refreshing…");
      // ВАЖНО: allowVisible = false → если silent refresh упадёт, не
      // открываем видимое окно из фоновой задачи. Просто логируем и
      // ждём следующего тика. Visible re-login откроется только когда
      // юзер сам сделает запрос и получит 401 (тогда refresh() будет
      // вызван с allowVisible = true).
      try {
        await this._doRefresh({
          forceVisible: false,
          skipSilent: false,
          allowVisible: false,
        });
      } catch (err) {
        // Логируем, но не открываем visible окно из фоновой задачи.
        console.warn(`[qwen-auth] proactive silent refresh failed (will retry next tick): ${err.message}`);
      }
    })();
    await this._proactiveInFlight.catch(() => {});
  }

  stopProactiveRefresh() {
    if (this._proactiveTimer) {
      clearTimeout(this._proactiveTimer);
      this._proactiveTimer = null;
    }
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
    // Запускаем proactive refresh — каждые 10 минут проверяет exp токена
    // и при необходимости делает silent refresh, не дожидаясь 401 от API.
    defaultManager.startProactiveRefresh();
  }
  return defaultManager;
}

export function isQwenAuthConfigured() {
  const auth = readQwenAuth(QWEN_AUTH_FILE);
  return Boolean(auth?.token);
}

// Публичная утилита для проверки протухания JWT (используется в
// api/openai-handler.mjs и src/window-app/server.mjs).
export function isQwenJwtExpired(token, skewSec = QWEN_REFRESH_SKEW_SEC) {
  return isQwenTokenExpired(token, skewSec);
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
