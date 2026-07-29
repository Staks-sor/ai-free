// Парсер Server-Sent Events ответа от /api/v0/chat/completion.
// Стриминг DeepSeek: events приходят чанками, каждый — JSON с дельтой текста.
// Цель: собрать все дельты в финальную строку + знать lastAssistantMessageId
// (для parent_message_id в следующем запросе цепочки).

export async function streamSse(res, debug, onText = null) {
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = "";
  let fullText = "";
  let lastAssistantMessageId = null;
  const fragments = new Map();
  let eventCount = 0;
  const eventTypes = new Set();

  const processEvent = (rawEvent) => {
    const event = parseSseEvent(rawEvent);
    if (!event.data) return;
    eventCount += 1;
    if (event.event) eventTypes.add(event.event);

    if (debug) console.error("[event]", event.event || "message", event.data.slice(0, 500));

    let parsed;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }

    const upstreamError = extractStreamError(parsed);
    if (upstreamError) throw new Error(`DeepSeek stream error: ${upstreamError}`);

    const { text, messageId } = extractDeltaText(parsed, fragments, event.event);
    if (messageId !== null) lastAssistantMessageId = messageId;
    if (text) {
      fullText += text;
      onText?.(text);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.match(/\r?\n\r?\n/))) {
      const boundaryIndex = boundary.index ?? 0;
      const rawEvent = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + boundary[0].length);
      processEvent(rawEvent);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) processEvent(buffer);
  if (!fullText) {
    const types = [...eventTypes].join(", ") || "message";
    const error = new Error(`DeepSeek stream ended without response content (events=${eventCount}, types=${types}).`);
    error.code = "EMPTY_UPSTREAM_STREAM";
    throw error;
  }

  return { lastAssistantMessageId, text: fullText };
}

function extractStreamError(value) {
  if (!value || typeof value !== "object") return "";
  if (value.error) return String(value.error?.message || value.error);
  const code = value.code ?? value.data?.biz_code;
  const message = value.message || value.msg || value.data?.biz_msg;
  if (code != null && Number(code) !== 0) return `${message || "upstream failure"} (code=${code})`;
  return "";
}

// Разбор одного SSE-фрейма: `event: name\ndata: json\n\n`.
export function parseSseEvent(raw) {
  const event = { event: "", data: "" };
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("event:")) event.event = line.slice(6).trim();
    else if (line.startsWith("data:")) {
      event.data += (event.data ? "\n" : "") + line.slice(5).trimStart();
    }
  }
  return event;
}

// DeepSeek SSE имеет несколько форматов сразу — нам нужен текст из всех:
// 1) { "v": "delta-string" } прямо в корне.
// 2) { "o": "APPEND", "p": ".../content", "v": "delta" }
// 3) { "o": "BATCH", "v": [ ... ] } — массив вложенных операций.
// 4) Объекты с type === RESPONSE/TEMPLATE_RESPONSE/THINK и полным content
//    (с накоплением — сравниваем с предыдущим значением, вычисляем delta).
// 5) OpenAI-совместимый формат choices[0].delta.content.
export function extractDeltaText(value, cache, eventName = "") {
  let messageId = null;
  let text = "";

  function visit(node, path) {
    if (!node || typeof node !== "object") return;

    if (typeof node.response_message_id === "number") {
      messageId = node.response_message_id;
    }
    if (typeof node.message_id === "number") messageId = node.message_id;
    if (typeof node.id === "number" && node.role === "ASSISTANT") messageId = node.id;

    if (path === "$" && Object.keys(node).length === 1 && typeof node.v === "string") {
      text += node.v;
      return;
    }

    if (
      node.o === "APPEND" &&
      typeof node.p === "string" &&
      node.p.endsWith("/content") &&
      typeof node.v === "string"
    ) {
      text += node.v;
      return;
    }

    if (node.o === "BATCH" && Array.isArray(node.v)) {
      node.v.forEach((item, index) => visit(item, `${path}.v.${index}`));
      return;
    }

    if (
      typeof node.content === "string" &&
      ["RESPONSE", "TEMPLATE_RESPONSE", "THINK"].includes(node.type)
    ) {
      const key = `${messageId ?? "unknown"}:${path}:${node.type}`;
      const previous = cache.get(key) || "";
      const current = node.content;
      const delta = current.startsWith(previous) ? current.slice(previous.length) : current;
      cache.set(key, current);
      text += delta;
    }

    if (typeof node?.choices?.[0]?.delta?.content === "string") {
      text += node.choices[0].delta.content;
    }

    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}.${index}`));
      return;
    }

    for (const [key, item] of Object.entries(node)) {
      if (key === "content" || key === "choices") continue;
      visit(item, `${path}.${key}`);
    }
  }

  visit(value, "$");
  return { text, messageId };
}
