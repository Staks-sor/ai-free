// Harvest: достаём сохранённый ответ Qwen из истории чата (2026-08).
//
// Когда стрим оборвался, а resume-POST (по response_id) не восстановил
// генерацию, сервер часто уже ДОДУМАЛ ответ и сохранил его в дерево
// сообщений чата. Вместо слепого повторного POST (который плодит
// sibling-ветки "2/2", "3/4") читаем историю:
//
//   GET /api/v2/chats/{chatId}?direction=up&limit=10
//   GET /api/v2/chats/{chatId}?cursor={msgId}&direction=down&limit=10
//
// и ищем сообщение с id (или response_id) == responseId. Если нашли —
// отдаём его контент как готовый ответ без каких-либо ретраев.
//
// Модуль намеренно не знает про browser-proxy: fetcher инжектится
// вызывающим слоем (прокси-GET или прямой fetch), что делает его
// тривиально тестируемым.

// Максимальное число страниц истории, которые просматриваем при поиске.
const MAX_HISTORY_PAGES = Number(process.env.QWEN_HARVEST_MAX_PAGES || 5);

// Пауза перед harvest-попыткой: если сервер ещё генерирует, ответ ещё не
// сохранён — короткий sleep и повторный GET повышают шанс успеть к финалу.
const HARVEST_RETRY_DELAY_MS = Number(process.env.QWEN_HARVEST_RETRY_DELAY_MS || 3000);
const HARVEST_RETRIES = Number(process.env.QWEN_HARVEST_RETRIES ?? 1);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageNodeResponseId(node) {
  if (node?.response_id != null) return String(node.response_id);
  return "";
}

function messageNodeId(node) {
  if (node?.id != null) return String(node.id);
  return "";
}

// Один GET истории (одна страница). fetcher({ cursor, direction, limit })
// возвращает либо распарсенный payload напрямую ({ data: { messages } }),
// либо обёртку browser-proxy proxyApiGet ({ ok, status, json }) —
// поддерживаем оба формата.
async function fetchHistoryPage(fetcher, chatId, { cursor = null, direction = "up", limit = 10 } = {}) {
  const result = await fetcher({ chatId, cursor, direction, limit });
  const data = result?.data ?? result?.json?.data;
  if (Array.isArray(data?.messages)) return data.messages;
  if (Array.isArray(data)) return data;
  return [];
}

// Ищет узел с id/response_id == responseId среди страницы сообщений.
function findSavedResponse(messages, responseId) {
  for (const node of messages) {
    if (messageNodeId(node) === responseId) return node;
    if (messageNodeResponseId(node) === responseId) return node;
  }
  return null;
}

// Достаёт текст из сохранённого узла ассистента. Контент может быть
// строкой или массивом частей (как в HAR морды).
function savedNodeToText(node) {
  const content = node?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .filter(Boolean)
      .join("");
  }
  return "";
}

export async function harvestQwenChatMessage({
  fetcher,
  chatId,
  responseId,
  fetchChildren = false,
  retries = HARVEST_RETRIES,
  retryDelayMs = HARVEST_RETRY_DELAY_MS,
  maxPages = MAX_HISTORY_PAGES,
  logger = null,
}) {
  const rid = String(responseId || "");
  if (!rid) return { found: false, reason: "no_response_id" };

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(retryDelayMs);
    try {
      let cursor = null;
      for (let page = 0; page < maxPages; page += 1) {
        const messages = await fetchHistoryPage(fetcher, chatId, { cursor });
        const node = findSavedResponse(messages, rid);
        if (node) {
          const text = savedNodeToText(node);
          if (text.trim()) {
            return { found: true, text, messageId: messageNodeId(node) || rid, pages: page + 1, attempts: attempt + 1 };
          }
          // Узел найден, но пуст — генерация ещё пишется; ждём и пробуем снова.
          break;
        }
        const next = nextCursor(messages);
        // Нет курсора или курсор не двигается — история просмотрена, дальше некуда.
        if (!next || next === cursor) break;
        cursor = next;
      }
    } catch (error) {
      lastError = error;
      logger?.warn?.("provider.qwen.harvest", { error: error?.message || String(error) });
    }
  }

  if (lastError) return { found: false, reason: "http_error", error: lastError?.message || String(lastError) };
  return { found: false, reason: "not_saved_yet" };
}

// Курсор пагинации: берём id последнего сообщения страницы.
function nextCursor(messages, _prevCursor, direction) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const last = messages[messages.length - 1];
  const id = messageNodeId(last);
  return id || null;
}
