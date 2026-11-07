// Qwen cookie_gate policy_version:2 (2026-09-30 ~15:42 UTC): JWT переехал из
// localStorage["token"] в localStorage["qwen_access_token_state"] — JSON вида
// {"version":1,"stateId":"…","token":"<JWT>",…}. Этот модуль — единая точка
// чтения: новый ключ приоритетен, старый — fallback (на случай отката).

export const QWEN_TOKEN_STATE_KEY = "qwen_access_token_state";
export const QWEN_TOKEN_LEGACY_KEY = "token";

// Node-сторона: распарсить значение нового ключа (raw string) в JWT.
export function parseQwenTokenState(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === "string" && parsed.token) return parsed.token;
  } catch {}
  return null;
}

// In-page сниппет для page.evaluate: читает новый ключ, падает на старый.
// Держать самодостаточным (без внешних переменных) — сериализуется в браузер.
export const QWEN_TOKEN_SNIPPET_SRC = `(() => {
  try {
    const raw = localStorage.getItem("qwen_access_token_state");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.token === "string" && parsed.token) return parsed.token;
      } catch {}
    }
  } catch {}
  try { return localStorage.getItem("token") || null; } catch { return null; }
})()`;
