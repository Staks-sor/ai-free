// HTTP-заголовки для запросов к chat.qwen.ai.
// В отличие от DeepSeek — НЕТ Authorization Bearer. Auth идёт только через cookies.
// X-Request-Id и Timezone генерим динамически на каждый запрос.

import { randomUUID } from "node:crypto";

// Date.toString() в системной локали может содержать кириллицу
// в названии таймзоны "(Москва, стандартное время)". В HTTP-заголовках
// non-ASCII запрещены — fetch падает с ByteString error.
// Делаем чистый ASCII-таймштамп в формате, который шлёт фронт Qwen.
function asciiTimezoneString() {
  const d = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n) => String(n).padStart(2, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const offsetH = pad(Math.floor(Math.abs(offsetMin) / 60));
  const offsetM = pad(Math.abs(offsetMin) % 60);
  return (
    `${days[d.getDay()]} ${months[d.getMonth()]} ${pad(d.getDate())} ${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ` +
    `GMT${sign}${offsetH}${offsetM}`
  );
}

export function qwenBaseHeaders(cookieHeader) {
  const headers = {
    Accept: "application/json",
    "Accept-Language": "ru-RU,ru;q=0.9",
    "Content-Type": "application/json",
    Origin: "https://chat.qwen.ai",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    Cookie: cookieHeader,
    "X-Accel-Buffering": "no",
    "X-Request-Id": randomUUID(),
    "bx-v": "2.5.36",
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    source: "web",
    Timezone: asciiTimezoneString(),
  };

  // Alibaba security tokens. Без них Qwen API отвечает Bad_Request.
  // - bx-umidtoken — стабильный device fingerprint. Можно вытащить из куки lswusea
  //   (часть до @@timestamp) или задать вручную через .env.
  // - bx-ua — динамическая подпись (~2000 символов). Генерируется JS+WASM их фронта,
  //   мы её не реверсим. Юзер должен один раз вытащить из DevTools и положить в .env.
  //   Возможно требует периодического обновления (TBD).
  const umidFromCookie = extractUmidFromCookieHeader(cookieHeader);
  const bxUmidToken = process.env.QWEN_BX_UMIDTOKEN || umidFromCookie || null;
  const bxUa = process.env.QWEN_BX_UA || null;

  if (bxUmidToken) headers["bx-umidtoken"] = bxUmidToken;
  if (bxUa) headers["bx-ua"] = bxUa;

  return headers;
}

// Кука `lswusea` имеет вид "<base64>=@@<timestamp>". Возвращаем часть до @@.
function extractUmidFromCookieHeader(cookieHeader) {
  if (!cookieHeader) return null;
  const m = String(cookieHeader).match(/(?:^|;\s*)lswusea=([^;]+)/);
  if (!m) return null;
  const raw = decodeURIComponent(m[1]);
  const at = raw.indexOf("@@");
  return at >= 0 ? raw.slice(0, at) : raw;
}
