// Детект и сообщения об устаревшей сессии Qwen (chat.qwen.ai).

export const QWEN_RELOGIN_IN_PROGRESS_MESSAGE =
  "🔒 Сессия Qwen устарела — открываю окно входа chat.qwen.ai.\n\n" +
  "Войди в аккаунт в открывшемся окне браузера. После входа запрос повторится автоматически.";

export function formatQwenSessionExpiredMessage({ code = "", details = "", reloginFailed = false } = {}) {
  const extra = [code, details].filter(Boolean).join(": ");
  if (reloginFailed) {
    return [
      "🔒 Не удалось обновить сессию Qwen",
      "",
      "Окно входа закрыто или вход не завершён.",
      "",
      "Нажми «Подключить» у провайдера Qwen в окне нового чата — откроется тот же вход, что и при первом логине.",
      extra ? `\nТехнически: ${extra}` : "",
    ].join("\n").trim();
  }
  return [
    "🔒 Сессия Qwen устарела",
    "",
    "Сейчас ai-free откроет окно входа chat.qwen.ai (как при первом подключении).",
    "Войди в аккаунт — запрос повторится сам.",
    extra ? `\nТехнически: ${extra}` : "",
  ].join("\n").trim();
}

export function isQwenSessionExpiredCode(code, details = "") {
  const c = String(code || "").toLowerCase();
  const d = String(details || "").toLowerCase();
  // Bad_Request + generic Internal error — anti-bot/подпись запроса, НЕ протухшая сессия.
  // createChat при живой сессии тоже проходит, а complete падает с этим кодом.
  if (c === "bad_request" && /internal error/i.test(d) && !/invalid token|expired|unauthorized|login/i.test(d)) {
    return false;
  }
  if (c === "bad_request" && /invalid token|expired|unauthorized|login required|not.?logged/i.test(d)) {
    return true;
  }
  if (c === "internal_error" && /expired|unauthorized|login required|invalid.?token|session.?expired/i.test(d)) {
    return true;
  }
  if (/unauthorized|not.?logged|login required|token.?expired|session.?expired|invalid.?token|sign.?in/i.test(d)) {
    return true;
  }
  return false;
}

// Отклонение anti-bot на /completions — сессия может быть жива (createChat OK).
export function isQwenAntiBotRejection(code, details = "") {
  const c = String(code || "").toLowerCase();
  const d = String(details || "").toLowerCase();
  if (c === "bad_request" && /internal error/i.test(d)) return true;
  return false;
}

export function formatQwenAntiBotMessage({ code = "Bad_Request", details = "" } = {}) {
  return [
    "Qwen отклонил запрос (anti-bot / подпись запроса).",
    "",
    "Сессия, скорее всего, жива — чат создаётся, но отправка сообщения блокируется.",
    "",
    "Что попробовать:",
    "• Повтори запрос через минуту",
    "• Перезапусти ai-free (npm start)",
    "• Открой chat.qwen.ai в обычном Chrome — если там тоже ошибка, это на стороне Qwen",
    "• Кнопка «Подключить» у Qwen — только если в браузере просит войти заново",
    "",
    `Код: ${code}`,
    details ? String(details).slice(0, 200) : "",
  ].filter(Boolean).join("\n");
}

export function isQwenSessionExpiredText(text = "") {
  const blob = String(text || "").toLowerCase();
  if (!blob) return false;
  if (/<!doctype html|<html[\s>]/i.test(blob) && /login|sign.?in|auth/i.test(blob)) return true;
  if (/unauthorized|not logged|login required|token expired|session expired|invalid token/i.test(blob)) return true;
  if (/сессия qwen устарела/i.test(blob)) return true;
  return false;
}

export function isQwenSessionExpiredError(error) {
  if (!error) return false;
  if (error.isQwenReloginFailed) return false;
  if (error.isQwenSessionExpired) return true;
  const status = error.status || error.httpStatus;
  if (status === 401 || status === 403) return true;
  return isQwenSessionExpiredText(error.message);
}

export function createQwenReloginFailedError({ code = "", details = "", context = "" } = {}) {
  const message = formatQwenSessionExpiredMessage({ code, details, reloginFailed: true });
  const err = new Error(context ? `${context}: ${message}` : message);
  err.name = "QwenReloginFailedError";
  err.isAuthError = true;
  err.isQwenReloginFailed = true;
  err.code = code || "relogin_failed";
  err.details = details;
  return err;
}

export function createQwenSessionExpiredError({ code = "", details = "", context = "" } = {}) {
  const message = formatQwenSessionExpiredMessage({ code, details });
  const err = new Error(context ? `${context}: ${message}` : message);
  err.name = "QwenSessionExpiredError";
  err.isAuthError = true;
  err.isQwenSessionExpired = true;
  err.code = code || "session_expired";
  err.details = details;
  return err;
}

export function throwIfQwenSessionExpiredFromHttp(status, text, context) {
  if (status === 401 || status === 403) {
    throw createQwenSessionExpiredError({
      code: String(status),
      details: String(text || "").slice(0, 300),
      context,
    });
  }
  const body = String(text || "");
  if (/<!doctype html|<html[\s>]/i.test(body)) {
    throw createQwenSessionExpiredError({
      code: "html_response",
      details: "chat.qwen.ai вернул HTML вместо API — обычно это страница логина или WAF",
      context,
    });
  }
  try {
    const json = JSON.parse(body);
    const fromJson = extractQwenErrorFields(json);
    if (fromJson && isQwenSessionExpiredCode(fromJson.code, fromJson.details)) {
      throw createQwenSessionExpiredError({ ...fromJson, context });
    }
  } catch (error) {
    if (error?.isQwenSessionExpired) throw error;
  }
  if (isQwenSessionExpiredText(body)) {
    throw createQwenSessionExpiredError({
      code: "session_expired",
      details: body.slice(0, 300),
      context,
    });
  }
}

export function throwIfQwenSessionExpiredFromAssistantText(text, context = "") {
  const msg = String(text || "");
  if (!isQwenSessionExpiredText(msg) && !isQwenSessionExpiredCode(extractCodeFromUserMessage(msg), msg)) {
    return;
  }
  throw createQwenSessionExpiredError({
    code: extractCodeFromUserMessage(msg) || "session_expired",
    details: msg.slice(0, 300),
    context,
  });
}

function extractCodeFromUserMessage(text) {
  const m = String(text || "").match(/\(([^)]+)\):/);
  return m?.[1] || "";
}

export function extractQwenErrorFields(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.error && typeof parsed.error === "object") {
    return {
      code: String(parsed.error.code || parsed.error.type || "error"),
      details: String(parsed.error.details || parsed.error.message || parsed.error.detail || ""),
    };
  }
  if (parsed.success === false && parsed.data && typeof parsed.data === "object") {
    return {
      code: String(parsed.data.code || parsed.data.type || "error"),
      details: String(parsed.data.details || parsed.data.message || parsed.data.detail || ""),
    };
  }
  return null;
}
