// Гибридный retrieval: FTS + vector (RRF merge).

const RRF_K = 60;

export function mergeHybridResults(ftsItems = [], vectorItems = [], { limit = 20 } = {}) {
  const byId = new Map();
  const scores = new Map();

  const ingest = (items, source) => {
    for (let rank = 0; rank < items.length; rank += 1) {
      const item = items[rank];
      if (!item?.id) continue;
      scores.set(item.id, (scores.get(item.id) || 0) + 1 / (RRF_K + rank + 1));
      if (!byId.has(item.id)) {
        byId.set(item.id, { ...item, _sources: new Set([source]) });
      } else {
        byId.get(item.id)._sources.add(source);
      }
    }
  };

  ingest(ftsItems, "fts");
  ingest(vectorItems, "vector");

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => {
      const item = byId.get(id);
      const sources = item._sources ? [...item._sources] : [];
      const { _sources, ...rest } = item;
      return {
        ...rest,
        _hybridScore: score,
        _vectorMatch: sources.includes("vector"),
        _ftsMatch: sources.includes("fts"),
      };
    });
}
