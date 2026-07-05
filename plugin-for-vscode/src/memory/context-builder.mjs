// Сбор релевантного memory-контекста для system prompt.

import { searchMemory } from "./store.mjs";
import { getAntiRepeatContext } from "./replay.mjs";
import { expandMemoryWithGraph } from "./graph/traverse.mjs";

function truncate(text, max = 320) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

export function buildMemoryContextResult(task, workspaceRoot = "", { memoryEnabled = true } = {}) {
  if (memoryEnabled === false) {
    return { context: "", usedCount: 0 };
  }

  const antiRepeat = getAntiRepeatContext(task, workspaceRoot);
  const relevant = expandMemoryWithGraph(
    searchMemory(task, workspaceRoot),
    workspaceRoot,
    { maxHops: 1, limit: 6 },
  );
  const lines = [];
  let usedCount = 0;
  let graphUsed = 0;

  if (antiRepeat.summary && antiRepeat.summary !== "No previous similar errors found.") {
    lines.push(antiRepeat.summary);
    usedCount += (antiRepeat.raw?.errors?.length || 0) + (antiRepeat.raw?.fixes?.length || 0);
  }

  const seen = new Set();
  for (const item of relevant.slice(0, 14)) {
    if (!item?.content || seen.has(item.id)) continue;
    seen.add(item.id);
    const graphTag = item._graphRelated ? " ↗graph" : "";
    const vectorTag = item._vectorMatch && !item._ftsMatch ? " ↗vec" : "";
    lines.push(`- [${item.type}${graphTag}${vectorTag}] ${truncate(item.content)}`);
    usedCount += 1;
    if (item._graphRelated) graphUsed += 1;
  }

  return {
    context: lines.length ? lines.join("\n") : "",
    usedCount,
    graphUsed,
  };
}

export function buildMemoryContext(task, workspaceRoot = "", options = {}) {
  return buildMemoryContextResult(task, workspaceRoot, options).context;
}
