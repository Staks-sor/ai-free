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
  if (Array.isArray(result)) return result;
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

// ─────────────────────────────────────────────────────────────────────────────
// Восстановление ТРАНСПОРТНОГО обрыва (2026-08-21, полевой инцидент:
// чат «Qwen Account Pool Implementation»). AbortError: BodyStreamBuffer /
// net::ERR_ABORTED до первого чанка: POST доставлен, сервер генерит, но
// клиент #completionRound слепо re-POSTал тот же body (тот же timestamp_ms)
// → второй юзер-месседж → sibling-ветка «1/2» под запросом, ответ #1
// потерян, пользователю уезжает ответ #2.
//
// Вместо слепого re-POST: поллим историю чата, ждём завершения генерации
// и забираем готовый ответ. Если история не показывает НОВЫХ сообщений за
// разумное время — POST доказуемо не доставлен, только тогда re-POST
// безопасен (вызывающий слой решает).
// ─────────────────────────────────────────────────────────────────────────────

// Признаки завершённости узла-ассистента в истории.
function assistantNodeIsDone(node) {
  if (node?.done === false) return false;
  if (node?.is_stop === true) return false;
  return Boolean(savedNodeToText(node).trim());
}

export async function harvestLatestAssistantMessage({
  fetcher,
  chatId,
  knownIds = [],
  pollMs = 3000,
  timeoutMs = 120_000,
  logger = null,
}) {
  const known = new Set(knownIds.map(String));
  const deadline = Date.now() + Math.max(1000, timeoutMs);
  let polls = 0;
  let sawNew = false;

  while (Date.now() < deadline) {
    polls += 1;
    let messages = [];
    try {
      messages = await fetchHistoryPage(fetcher, chatId, {});
    } catch (error) {
      logger?.warn?.("provider.qwen.harvest", { error: error?.message || String(error) });
    }
    const fresh = messages.filter((m) => !known.has(messageNodeId(m)));
    if (fresh.length > 0) sawNew = true;
    const lastAssistant = [...fresh].reverse().find(
      (m) => String(m?.role) === "assistant" && assistantNodeIsDone(m),
    );
    if (lastAssistant) {
      return {
        found: true,
        text: savedNodeToText(lastAssistant),
        messageId: messageNodeId(lastAssistant),
        polls,
      };
    }
    if (fresh.length === 0 && polls >= 2) {
      // Два опроса подряд без единого нового сообщения: POST не доставлен.
      return { found: false, reason: "post_not_delivered", polls };
    }
    await sleep(pollMs);
  }
  return { found: false, reason: sawNew ? "generation_timeout" : "post_not_delivered", polls };
}

// Обёртка для client.mjs: транспортный сбой после отправки completion-POST.
// Прокси и паузы инжектируются для тестируемости. Возвращает parsed-объект
// (совместим с результатом парсера стрима) или null, если восстановить
// не удалось (POST не доставлен / прокси мёртв) — тогда вызывающий слой
// может безопасно повторить POST.
export async function harvestTransportFailedCompletion({
  chatId,
  streamedText = "",
  knownIds = [],
  onText = null,
  getProxy,
  pollMs = 3000,
  timeoutMs = 120_000,
  debug = false,
}) {
  try {
    const proxy = await getProxy();
    const harvested = await harvestLatestAssistantMessage({
      fetcher: ({ chatId: cid }) => proxy.proxyApiGet({ path: `/api/v2/chats/${cid}?direction=up&limit=20` }),
      chatId,
      knownIds,
      pollMs,
      timeoutMs,
      logger: null,
    });
    if (!harvested.found) {
      if (debug) console.log(`[qwen] transport-failure harvest: ${harvested.reason}`);
      return null;
    }
    let tail = "";
    if (typeof streamedText === "string" && streamedText) {
      // Дельты уже ушли до обрыва: хвост = harvested минус уже отправленный префикс.
      if (harvested.text.startsWith(streamedText)) {
        tail = harvested.text.slice(streamedText.length);
      } else {
        tail = harvested.text;
      }
    } else {
      tail = harvested.text;
    }
    if (tail && typeof onText === "function") onText(tail);
    return {
      text: streamedText ? (harvested.text.startsWith(streamedText) ? harvested.text : streamedText + tail) : tail,
      thinkingText: "",
      lastMessageId: harvested.messageId,
      error: null,
      streamFinished: true,
      truncated: false,
      responseId: "",
      contentReceived: true,
      harvested: true,
      harvestedViaTransportRecovery: true,
    };
    // eslint-disable-next-line no-useless-catch
  } catch (error) {
    if (debug) console.log(`[qwen] transport-failure harvest error: ${error?.message || error}`);
    return null;
  }
}
