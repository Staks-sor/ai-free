export function parseModelToolCalls(text) {
  const source = String(text || "");
  const block = extractToolCallsBlock(source) || extractXmlToolCallsBlock(source);
  if (!block) return { content: source, calls: [] };

  const calls = block.calls || parseCallsJson(block.json);
  if (!calls.length) return { content: source, calls: [] };

  return {
    content: source.slice(0, block.start).trim(),
    calls,
  };
}

export function parseXmlToolCalls(text) {
  const source = String(text || "");
  const block = extractXmlToolCallsBlock(source);
  return block?.calls || [];
}

function extractToolCallsBlock(source) {
  const fence = source.match(/```tool_calls\s*([\s\S]*?)```/i);
  if (!fence) return null;

  const blockStart = fence.index ?? 0;
  const raw = fence[1].trim();
  const firstArray = raw.indexOf("[");
  const lastArray = raw.lastIndexOf("]");
  if (firstArray >= 0 && lastArray >= firstArray) {
    return { start: blockStart, json: raw.slice(firstArray, lastArray + 1) };
  }

  const firstObject = raw.indexOf("{");
  const lastObject = raw.lastIndexOf("}");
  if (firstObject >= 0 && lastObject >= firstObject) {
    return { start: blockStart, json: raw.slice(firstObject, lastObject + 1) };
  }

  return null;
}

function parseCallsJson(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map(normalizeCall).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeCall(call) {
  if (!call || typeof call !== "object") return null;
  const name = typeof call.name === "string"
    ? call.name
    : typeof call.tool === "string"
      ? call.tool
      : "";
  if (!name) return null;

  let args = call.arguments;
  if (args === undefined) {
    const { name: _name, tool: _tool, ...rest } = call;
    args = rest;
  }

  return {
    name,
    arguments: typeof args === "string" ? args : JSON.stringify(args || {}),
  };
}

function extractXmlToolCallsBlock(source) {
  const calls = [];
  let firstStart = -1;
  let lastEnd = -1;

  const wrappedToolCallRe = /<tool_call\s+name=(["'])([^"']+)\1\s*>([\s\S]*?)<\/tool_call>/gi;
  for (const match of source.matchAll(wrappedToolCallRe)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const call = normalizeXmlToolCall(match[2], match[3]);
    if (!call) continue;
    calls.push(call);
    if (firstStart === -1 || start < firstStart) firstStart = start;
    if (end > lastEnd) lastEnd = end;
  }

  const qwenFunctionRe = /<function=([^\s>]+)[^>]*>([\s\S]*?)<\/function>/gi;
  for (const match of source.matchAll(qwenFunctionRe)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const call = normalizeQwenFunctionCall(match[1], match[2]);
    if (!call) continue;
    calls.push(call);
    if (firstStart === -1 || start < firstStart) firstStart = start;
    if (end > lastEnd) lastEnd = end;
  }

  if (!calls.length) return null;

  const wrapperStart = source.lastIndexOf("<tool_calls", firstStart);
  if (wrapperStart !== -1) {
    const wrapperEnd = source.indexOf("</tool_calls>", lastEnd);
    if (wrapperEnd !== -1) {
      firstStart = wrapperStart;
      lastEnd = wrapperEnd + "</tool_calls>".length;
    }
  }

  return { start: firstStart, end: lastEnd, calls };
}

function normalizeXmlToolCall(name, rawBody) {
  const toolName = cleanToolName(name);
  if (!toolName) return null;

  const body = String(rawBody || "").trim();
  if (!body) return { name: toolName, arguments: "{}" };

  const parsed = parseJsonishObject(body);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return normalizeCall({ name: toolName, arguments: parsed });
  }

  return normalizeCall({ name: toolName, arguments: body });
}

function normalizeQwenFunctionCall(name, rawBody) {
  const toolName = cleanToolName(name);
  if (!toolName) return null;

  const args = {};
  const paramRe = /<parameter=([^\s>]+)[^>]*>([\s\S]*?)<\/parameter>/gi;
  for (const match of String(rawBody || "").matchAll(paramRe)) {
    const key = cleanToolName(match[1]);
    if (!key) continue;
    const value = decodeXmlText(match[2].trim());
    const parsed = parseJsonishValue(value);
    args[key] = parsed === undefined ? value : parsed;
  }

  return normalizeCall({ name: toolName, arguments: args });
}

function cleanToolName(value) {
  return String(value || "")
    .replace(/^★-/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function parseJsonishObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    const first = value.indexOf("{");
    const last = value.lastIndexOf("}");
    if (first === -1 || last < first) return null;
    try {
      const parsed = JSON.parse(value.slice(first, last + 1));
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
}

function parseJsonishValue(value) {
  if (!value) return "";
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
