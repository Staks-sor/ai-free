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

export function parseToolCall(text, options = {}) {
  const trimmed = String(text || "").trim();

  const workspaceFile = findWorkspaceFileCall(trimmed, options);
  if (workspaceFile) return workspaceFile;

  const xmlResult = findXmlToolCall(trimmed);
  if (xmlResult) return xmlResult;

  const fencedBlocks = [
    ...trimmed.matchAll(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/gi),
  ];
  for (const match of fencedBlocks) {
    const result = findToolCallInText(match[1].trim(), options);
    if (result) return result;
  }

  const stripped = trimmed.replace(/```[a-zA-Z0-9]*\n?[\s\S]*?```/gi, " ");
  const result2 = findToolCallInText(stripped, options);
  if (result2) return result2;

  return findToolCallInText(trimmed, options);
}

function findWorkspaceFileCall(text, options) {
  const match = text.match(/<workspace_file\s+tool=(["'])(write_file|append_file)\1\s+path=(["'])([^"']+)\3(?:\s+indent=(["'])levels\5)?\s*>([\s\S]*?)<\/workspace_file>/i);
  if (!match) return null;
  const rawContent = match[6].replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  return {
    tool: match[2],
    path: normalizeWorkspaceValue(match[4], options),
    content: match[5] ? restoreIndentLevels(rawContent, options) : rawContent,
  };
}

function restoreIndentLevels(content, options) {
  return content.split(/\r?\n/).map((line) => {
    const match = line.match(/^\|(\d{1,2})\|(.*)$/);
    if (!match) return line;
    const restoredText = normalizeWorkspaceValue(match[2], options);
    return `${" ".repeat(Math.min(Number(match[1]), 25) * 4)}${restoredText}`;
  }).join("\n");
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
function findToolCallInText(text, options) {
  let offset = 0;

  while (offset < text.length) {
    const start = text.indexOf("{", offset);
    if (start < 0) return null;

    const candidate = extractFirstJsonObject(text.slice(start));
    if (!candidate) {
      return null;
    }

    try {
      const parsed = normalizeToolCall(JSON.parse(candidate), options);
      if (parsed) return parsed;
    } catch {
      try {
        const parsed = normalizeToolCall(JSON.parse(escapeLiteralJsonControlCharacters(candidate)), options);
        if (parsed) return parsed;
      } catch {
        // Невалидный JSON — пробуем следующий объект.
      }
    }

    offset = start + Math.max(candidate.length, 1);
  }

  return null;
}

function escapeLiteralJsonControlCharacters(value) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const char of value) {
    if (!inString) {
      result += char;
      if (char === '"') inString = true;
      continue;
    }

    if (escaped) {
      result += char;
      escaped = false;
    } else if (char === "\\") {
      result += char;
      escaped = true;
    } else if (char === '"') {
      result += char;
      inString = false;
    } else if (char === "\n") result += "\\n";
    else if (char === "\r") result += "\\r";
    else if (char === "\t") result += "\\t";
    else result += char;
  }

  return result;
}

function normalizeToolCall(parsed, options) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (typeof parsed.tool === "string") return normalizeWorkspaceToolPaths(parsed, options);

  // Some models emit ACP-ish or malformed tool JSON, for example:
  // {"":"write_file","path":"x","content":""}
  // {"name":"write_file","arguments":{"path":"x","content":""}}
  const emptyKeyTool = parsed[""];
  if (typeof emptyKeyTool === "string") {
    const { [""]: _ignored, ...rest } = parsed;
    return normalizeWorkspaceToolPaths({ tool: emptyKeyTool, ...rest }, options);
  }

  if (typeof parsed.name === "string" && parsed.arguments && typeof parsed.arguments === "object") {
    return normalizeWorkspaceToolPaths({ tool: parsed.name, ...parsed.arguments }, options);
  }

  return null;
}

function normalizeWorkspaceToolPaths(call, options) {
  if (typeof call.path !== "string") return call;
  return { ...call, path: normalizeWorkspaceValue(call.path, options) };
}

function normalizeWorkspaceValue(value, options) {
  const text = String(value);
  if (!options?.restoreGoogleMarkers) return text;
  return text
    .replaceAll("[LITERAL-US]", "\u0000")
    .replaceAll("[US]", "_")
    .replaceAll("\u0000", "[US]");
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
