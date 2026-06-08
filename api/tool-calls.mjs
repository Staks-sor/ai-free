export function parseModelToolCalls(text) {
  const source = String(text || "");
  const block = extractToolCallsBlock(source);
  if (!block) return { content: source, calls: [] };

  const calls = parseCallsJson(block.json);
  if (!calls.length) return { content: source, calls: [] };

  return {
    content: source.slice(0, block.start).trim(),
    calls,
  };
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
