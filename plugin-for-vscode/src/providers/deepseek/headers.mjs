// HTTP-заголовки для запросов к chat.deepseek.com.
// Имитируют реальный браузер DeepSeek-фронта.
//
// КРИТИЧНО: некоторые фичи (поиск) DeepSeek активирует ТОЛЬКО при наличии
// специального токена x-hif-leim. Этот токен подписанный, генерируется
// фронтом DeepSeek динамически. Если хочешь чтобы поиск работал — извлеки
// его из браузера и пропиши в .env: DEEPSEEK_HIF_LEIM=<полное значение>.
// Без него `search_enabled: true` молча игнорится сервером.

import { APP_VERSION, BASE_URL } from "../../config.mjs";

export function baseHeaders(cookieHeader, token, { hifLeim = "" } = {}) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    "Content-Type": "application/json",
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`,
    Cookie: cookieHeader,
    "X-App-Version": APP_VERSION,
    "x-client-platform": "web",
    "x-client-version": APP_VERSION,
    "x-client-locale": "ru",
    "x-client-timezone-offset": String(-new Date().getTimezoneOffset() * 60),
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  // Фичетокен DeepSeek для web search. Сначала берём актуальный из профиля,
  // затем env как ручной fallback для диагностики.
  const searchToken = String(hifLeim || process.env.DEEPSEEK_HIF_LEIM || "").trim();
  if (searchToken) {
    headers["x-hif-leim"] = searchToken;
  }

  return headers;
}
