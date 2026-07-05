// Связи experience → graph (task, file, error, fix).

import { addGraphEdge, upsertGraphNode } from "./store.mjs";

function memoryNodeId(memoryId) {
  return `mem:${memoryId}`;
}

export function linkExperienceToGraph({ task, experience, workspace = "", savedItems = [] }) {
  if (!savedItems.length) return { nodes: 0, edges: 0 };

  const ws = String(workspace || "");
  const intent = experience?.intent || "general";
  const files = Array.isArray(experience?.files) ? experience.files : [];
  const errors = Array.isArray(experience?.errors) ? experience.errors : [];

  let nodes = 0;
  let edges = 0;

  const taskNode = upsertGraphNode({
    kind: "task",
    label: String(task || "").slice(0, 120),
    workspace: ws,
  });
  nodes += 1;

  const mainItem = savedItems[0];
  const mainNode = upsertGraphNode({
    kind: "memory",
    label: `${mainItem.type}: ${String(mainItem.content || "").slice(0, 80)}`,
    memoryId: mainItem.id,
    workspace: ws,
  });
  nodes += 1;

  if (addGraphEdge({ fromId: taskNode.id, toId: mainNode.id, relation: "produced", workspace: ws })) {
    edges += 1;
  }

  const intentNode = upsertGraphNode({ kind: "intent", label: intent, workspace: ws });
  nodes += 1;
  if (addGraphEdge({ fromId: mainNode.id, toId: intentNode.id, relation: "classified_as", workspace: ws })) {
    edges += 1;
  }

  for (const filePath of files.slice(0, 12)) {
    const fileNode = upsertGraphNode({ kind: "file", label: filePath, workspace: ws });
    nodes += 1;
    if (addGraphEdge({ fromId: mainNode.id, toId: fileNode.id, relation: "touches", workspace: ws })) {
      edges += 1;
    }
  }

  for (const item of savedItems) {
    if (item.id === mainItem.id) continue;
    const itemNode = upsertGraphNode({
      kind: "memory",
      label: `${item.type}: ${String(item.content || "").slice(0, 60)}`,
      memoryId: item.id,
      workspace: ws,
    });
    nodes += 1;
    const relation = item.type === "error" ? "caused_by" : item.type === "fix" ? "fixed_in" : "related_to";
    if (addGraphEdge({ fromId: mainNode.id, toId: itemNode.id, relation, workspace: ws })) {
      edges += 1;
    }
  }

  if (errors.length && savedItems.some((item) => item.type === "fix")) {
    const fixItem = savedItems.find((item) => item.type === "fix");
    const errItem = savedItems.find((item) => item.type === "error");
    if (fixItem && errItem) {
      if (addGraphEdge({
        fromId: memoryNodeId(errItem.id),
        toId: memoryNodeId(fixItem.id),
        relation: "resolved_by",
        workspace: ws,
      })) {
        edges += 1;
      }
    }
  }

  return { nodes, edges };
}
