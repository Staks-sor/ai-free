// Обход графа — расширение FTS-результатов связанными memory id.

import { getMemoryById } from "../store.mjs";
import { getNeighbors } from "./store.mjs";

function memoryNodeId(memoryId) {
  return `mem:${memoryId}`;
}

export function collectRelatedMemoryIds(seedItems = [], workspace = "", { maxHops = 1, limit = 8 } = {}) {
  const result = [];
  const seen = new Set(seedItems.map((item) => item.id).filter(Boolean));
  let frontier = seedItems.map((item) => memoryNodeId(item.id)).filter(Boolean);

  for (let hop = 0; hop < maxHops && result.length < limit; hop += 1) {
    const nextFrontier = [];
    for (const nodeId of frontier) {
      const { nodes } = getNeighbors(nodeId, { workspace, limit: 16 });
      for (const node of nodes) {
        const memoryId = node.memory_id || (node.id?.startsWith("mem:") ? node.id.slice(4) : null);
        if (!memoryId || seen.has(memoryId)) continue;
        seen.add(memoryId);
        result.push(memoryId);
        nextFrontier.push(memoryNodeId(memoryId));
        if (result.length >= limit) break;
      }
      if (result.length >= limit) break;
    }
    frontier = nextFrontier;
  }

  return result;
}

export function expandMemoryWithGraph(seedItems = [], workspace = "", options = {}) {
  const relatedIds = collectRelatedMemoryIds(seedItems, workspace, options);
  const expanded = [...seedItems];
  const seen = new Set(seedItems.map((item) => item.id));

  for (const id of relatedIds) {
    if (seen.has(id)) continue;
    const item = getMemoryById(id);
    if (!item) continue;
    seen.add(id);
    expanded.push({ ...item, _graphRelated: true });
  }

  return expanded;
}
