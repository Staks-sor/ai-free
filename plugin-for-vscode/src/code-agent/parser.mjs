// Парсер JSON-tool-call'а из ответа LLM.
// Устойчив к markdown-блокам, тексту до/после JSON, нескольким JSON-объектам.
//
// 3 стратегии последовательно:
//   1. Пройтись по всем fenced-блокам ```...``` (любой язык: json, python, tool_calls),
//      искать tool в содержимом каждого.
//   2. Вырезать ВСЕ fenced-блоки (они часто содержат пояснения на python и т.п.)
//      и искать tool в остатке. Спасает Qwen-кейс: ```python ...``` + текст +
//      {"tool":"write_file",...} снаружи блока.
//   3. Fallback — искать в исходном тексте целиком.

export function parseToolCall(text) {
  const trimmed = String(text || "").trim();

  const xmlResult = findXmlToolCall(trimmed);
  if (xmlResult) return xmlResult;

  const fencedBlocks = [
    ...trimmed.matchAll(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/gi),
  ];
  for (const match of fencedBlocks) {
    const result = findToolCallInText(match[1].trim());
    if (result) return result;
  }

  const stripped = trimmed.replace(/```[a-zA-Z0-9]*\n?[\s\S]*?```/gi, " ");
  const result2 = findToolCallInText(stripped);
  if (result2) return result2;

  return findToolCallInText(trimmed);
}

function findXmlToolCall(text) {
  const match = text.match(/<tool_call\s+name=(["'])([^"']+)\1\s*>([\s\S]*?)<\/tool_call>/i);
  if (!match) return null;

  const tool = match[2];
  const rawBody = match[3].trim();
  if (!rawBody) return { tool };

  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { tool, ...parsed };
    }
  } catch {
    // Fall through to JSON extraction below.
  }

  const json = extractFirstJsonObject(rawBody);
  if (!json) return { tool };
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { tool, ...parsed };
    }
  } catch {
    // ignore
  }
  return { tool };
}

// Ищет первый JSON-объект с полем "tool" (string) в тексте.
// Если первый {...} не tool-call — пропускает и берёт следующий.
function findToolCallInText(text) {
  let offset = 0;

  while (offset < text.length) {
    const start = text.indexOf("{", offset);
    if (start < 0) return null;

    const candidate = extractFirstJsonObject(text.slice(start));
    if (!candidate) {
      return null;
    }

    try {
      const parsed = normalizeToolCall(JSON.parse(candidate));
      if (parsed) return parsed;
    } catch {
      // Невалидный JSON — пробуем следующий объект.
    }

    offset = start + Math.max(candidate.length, 1);
  }

  return null;
}

function normalizeToolCall(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (typeof parsed.tool === "string") return parsed;

  // Some models emit ACP-ish or malformed tool JSON, for example:
  // {"":"write_file","path":"x","content":""}
  // {"name":"write_file","arguments":{"path":"x","content":""}}
  const emptyKeyTool = parsed[""];
  if (typeof emptyKeyTool === "string") {
    const { [""]: _ignored, ...rest } = parsed;
    return { tool: emptyKeyTool, ...rest };
  }

  if (typeof parsed.name === "string" && parsed.arguments && typeof parsed.arguments === "object") {
    return { tool: parsed.name, ...parsed.arguments };
  }

  return null;
}

// Безопасный экстрактор первого валидного JSON-объекта из текста.
// Уважает строки и эскейпы, не путается на скобках внутри значений.
export function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}
