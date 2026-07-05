// Vector search поверх локальных эмбеддингов.

import {
  buildEmbedDocument,
  cosineSimilarity,
  deserializeVector,
  embedText,
  serializeVector,
} from "./embed.mjs";

export function vectorizeItem(item) {
  return embedText(buildEmbedDocument(item));
}

export function rankByVector(items = [], query = "", { limit = 20, minScore = 0.05 } = {}) {
  const q = String(query || "").trim();
  if (!q || !items.length) return [];

  const queryVec = embedText(q);
  const scored = [];

  for (const item of items) {
    const raw = item._vector || item.meta?.embedding;
    const vec = deserializeVector(raw);
    if (!vec) continue;
    const score = cosineSimilarity(queryVec, vec);
    if (score < minScore) continue;
    scored.push({ item, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, score }) => ({ ...item, _vectorScore: score }));
}

export function attachVectors(items = [], vectorMap = new Map()) {
  return items.map((item) => {
    const stored = vectorMap.get(item.id);
    if (!stored) return item;
    return { ...item, _vector: stored };
  });
}

export { serializeVector, deserializeVector, buildEmbedDocument };
