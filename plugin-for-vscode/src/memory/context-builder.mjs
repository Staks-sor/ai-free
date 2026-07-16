// Сбор релевантного memory-контекста для system prompt.

import { searchMemory } from "./store.mjs";
import { getAntiRepeatContext } from "./replay.mjs";
import { expandMemoryWithGraph } from "./graph/traverse.mjs";

const MAX_CONTEXT_ITEMS = 6;

function truncate(text, max = 320) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function uniqueKey(item = {}) {
  if (item.meta?.taskNormalized) return `task:${item.meta.taskNormalized}`;
  return String(item.content || "").toLowerCase().replace(/[^\p{L}\p{N}._/-]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function buildMemoryContextResult(task, workspaceRoot = "", { memoryEnabled = true } = {}) {
  if (memoryEnabled === false) return { context: "", usedCount: 0 };

  const antiRepeat = getAntiRepeatContext(task, workspaceRoot);
  const relevant = expandMemoryWithGraph(
    searchMemory(task, workspaceRoot),
    workspaceRoot,
    { maxHops: 1, limit: MAX_CONTEXT_ITEMS },
  );
  const lines = [];
  let usedCount = 0;
  let graphUsed = 0;

  if (antiRepeat.summary && antiRepeat.summary !== "No previous similar errors found.") {
    lines.push(antiRepeat.summary);
    usedCount += (antiRepeat.raw?.errors?.length || 0) + (antiRepeat.raw?.fixes?.length || 0);
  }

  const seenIds = new Set();
  const seenContent = new Set();
  for (const item of relevant) {
    if (!item?.content || seenIds.has(item.id)) continue;
    const key = uniqueKey(item);
    if (seenContent.has(key)) continue;
    seenIds.add(item.id);
    seenContent.add(key);
    const graphTag = item._graphRelated ? " ↗graph" : "";
    const vectorTag = item._vectorMatch && !item._ftsMatch ? " ↗vec" : "";
    lines.push(`- [${item.type}${graphTag}${vectorTag}] ${truncate(item.content)}`);
    usedCount += 1;
    if (item._graphRelated) graphUsed += 1;
    if (seenContent.size >= MAX_CONTEXT_ITEMS) break;
  }

  return { context: lines.length ? lines.join("\n") : "", usedCount, graphUsed };
}

export function buildMemoryContext(task, workspaceRoot = "", options = {}) {
  return buildMemoryContextResult(task, workspaceRoot, options).context;
}
