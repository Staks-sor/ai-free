// Сбор релевантного memory-контекста для system prompt.

import { searchMemory } from "./store.mjs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getMemorySourceVersion } from "./db.mjs";
import { expandMemoryWithGraph } from "./graph/traverse.mjs";

const contextCache = new Map();
const MAX_CACHE_ENTRIES = 64;
function sameWorkspace(item, root) {
  return !item.workspace || Boolean(root && path.resolve(item.workspace) === path.resolve(root));
}
function fitUtf8(text, maxBytes) {
  const bytes = Buffer.from(text);
  if (bytes.length <= maxBytes) return text;
  let end = Math.max(0, maxBytes);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
}

const MAX_CONTEXT_ITEMS = 6;
const MEMORY_REFERENCE_RE = /(?:продолж|предыдущ|прошл|снова|опять|раньше|помни|тот\s+же|та\s+же|возобнов|контекст|истори|памят|continue|previous|again|remember|same\s+(?:task|error)|memory)/iu;
const DIAGNOSTIC_CONTEXT_RE = /(?:timeout|timed\s+out|traceback|stack\s+trace|exception|ERR_[A-Z0-9_]+|ECONNRESET|ECONNREFUSED|ETIMEDOUT)/iu;

function truncate(text, max = 320) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function uniqueKey(item = {}) {
  if (item.meta?.taskNormalized) return `task:${item.meta.taskNormalized}`;
  return String(item.content || "").toLowerCase().replace(/[^\p{L}\p{N}._/-]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function shouldUseMemoryForTask(task) {
  const text = String(task || "").trim();
  if (!text) return false;
  return MEMORY_REFERENCE_RE.test(text) || DIAGNOSTIC_CONTEXT_RE.test(text);
}

export function filterRelevantMemoryItems(task, items = []) {
  const candidates = items.filter((item) => item?.content);
  if (candidates.length <= 1) return candidates;

  const scores = candidates
    .map((item) => Number(item._hybridScore))
    .filter(Number.isFinite);
  if (!scores.length) return candidates.slice(0, MAX_CONTEXT_ITEMS);

  const strongest = Math.max(...scores);
  const floor = strongest * 0.5;
  return candidates
    .filter((item, index) => index === 0 || Number(item._hybridScore) >= floor)
    .slice(0, MAX_CONTEXT_ITEMS);
}

export function buildMemoryContextResult(task, workspaceRoot = "", {
  memoryEnabled = true, forceMemory = false, maxContextBytes = 8192,
} = {}) {
  const empty = { context: "", usedCount: 0, graphUsed: 0, truncated: false, cacheHit: false };
  if (!memoryEnabled || (!forceMemory && !shouldUseMemoryForTask(task))) return empty;
  const budget = Math.max(0, Math.min(8192, Number(maxContextBytes) || 0));
  if (!budget) return empty;
  const sourceVersion = getMemorySourceVersion();
  const key = createHash('sha256').update(JSON.stringify([String(task), workspaceRoot ? path.resolve(workspaceRoot) : '', budget])).digest('hex');
  const cached = contextCache.get(key);
  if (cached?.sourceVersion === sourceVersion) {
    contextCache.delete(key); contextCache.set(key, cached);
    return { ...cached.result, cacheHit: true };
  }
  const matches = filterRelevantMemoryItems(task, searchMemory(task, workspaceRoot)
    .filter(item => sameWorkspace(item, workspaceRoot)));
  const relevant = matches.length ? expandMemoryWithGraph(matches, workspaceRoot,
    { maxHops: 1, limit: MAX_CONTEXT_ITEMS }) : [];
  const lines = [], seenIds = new Set(), seenContent = new Set();
  let usedCount = 0, graphUsed = 0, truncated = false;
  for (const item of relevant) {
    if (!item?.content || !sameWorkspace(item, workspaceRoot) || seenIds.has(item.id)) continue;
    const itemKey = uniqueKey(item);
    if (seenContent.has(itemKey)) continue;
    const graphTag = item._graphRelated ? " ↗graph" : "";
    const vectorTag = item._vectorMatch && !item._ftsMatch ? " ↗vec" : "";
    const known = item.type === 'error' || item.tags?.includes('error') ? ' KNOWN ERROR TO AVOID'
      : item.type === 'fix' || item.tags?.includes('fix') ? ' KNOWN FIX' : '';
    const text = truncate(item.content);
    truncated ||= text !== String(item.content).trim();
    const line = `- [${item.type}${known}${graphTag}${vectorTag}; memory:${item.id}] ${text}`;
    const remaining = budget - Buffer.byteLength(lines.join('\n')) - (lines.length ? 1 : 0);
    const bounded = fitUtf8(line, remaining);
    if (!bounded) { truncated = true; break; }
    lines.push(bounded); seenIds.add(item.id); seenContent.add(itemKey); usedCount++;
    if (item._graphRelated) graphUsed++;
    if (bounded !== line) { truncated = true; break; }
    if (usedCount >= MAX_CONTEXT_ITEMS) break;
  }
  const result = { context: lines.join('\n'), usedCount, graphUsed, truncated, cacheHit: false };
  contextCache.set(key, { sourceVersion, result });
  while (contextCache.size > MAX_CACHE_ENTRIES) contextCache.delete(contextCache.keys().next().value);
  return { ...result };
}

export function buildMemoryContext(task, workspaceRoot = "", options = {}) {
  return buildMemoryContextResult(task, workspaceRoot, options).context;
}
