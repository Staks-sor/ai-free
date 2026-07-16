// Гибридный retrieval: FTS прежде всего, vector — только как ограниченное дополнение.

const RRF_K = 60;
const VECTOR_ONLY_LIMIT = 2;
const VECTOR_ONLY_MIN_SCORE = 0.2;
const RECENCY_HALF_LIFE_DAYS = 180;

function normalizedKey(item = {}) {
  const task = item.meta?.taskNormalized;
  if (task) return `task:${task}`;
  return `content:${String(item.content || "").toLowerCase().replace(/[^\p{L}\p{N}._/-]+/gu, " ").trim().replace(/\s+/g, " ")}`;
}

function recencyFactor(item = {}) {
  const timestamp = Date.parse(item.updatedAt || item.createdAt || "");
  if (!Number.isFinite(timestamp)) return 1;
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  return 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS);
}

export function mergeHybridResults(ftsItems = [], vectorItems = [], { limit = 20 } = {}) {
  const byId = new Map();
  const scores = new Map();

  const ingest = (items, source) => {
    for (let rank = 0; rank < items.length; rank += 1) {
      const item = items[rank];
      if (!item?.id) continue;
      scores.set(item.id, (scores.get(item.id) || 0) + 1 / (RRF_K + rank + 1));
      if (!byId.has(item.id)) byId.set(item.id, { ...item, _sources: new Set([source]) });
      else byId.get(item.id)._sources.add(source);
    }
  };

  ingest(ftsItems, "fts");
  ingest(vectorItems, "vector");

  const ranked = [...scores.entries()]
    .map(([id, score]) => ({ id, score: score * recencyFactor(byId.get(id)) }))
    .sort((a, b) => b.score - a.score);

  const result = [];
  const seen = new Set();
  let vectorOnlyCount = 0;
  for (const { id, score } of ranked) {
    const item = byId.get(id);
    const sources = item._sources ? [...item._sources] : [];
    const ftsMatch = sources.includes("fts");
    const vectorMatch = sources.includes("vector");
    if (!ftsMatch) {
      if (!vectorMatch || item._vectorScore < VECTOR_ONLY_MIN_SCORE || vectorOnlyCount >= VECTOR_ONLY_LIMIT) continue;
      vectorOnlyCount += 1;
    }
    const key = normalizedKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    const { _sources, ...rest } = item;
    result.push({ ...rest, _hybridScore: score, _vectorMatch: vectorMatch, _ftsMatch: ftsMatch });
    if (result.length >= limit) break;
  }
  return result;
}
