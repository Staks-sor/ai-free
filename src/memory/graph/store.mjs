// Граф памяти — узлы и рёбра (SQLite + JSON fallback).

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { MEMORY_BASE, MEMORY_DB, ensureMemoryDirs } from "../paths.mjs";

const require = createRequire(import.meta.url);
const GRAPH_JSON = path.join(MEMORY_BASE, "graph.json");

let sqliteDb = null;
let jsonGraph = null;
let backend = null;

export function resetGraphBackendForTests() {
  sqliteDb = null;
  jsonGraph = null;
  backend = null;
}

function openGraphDb(DatabaseSync) {
  ensureMemoryDirs();
  const db = new DatabaseSync(MEMORY_DB);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_graph_nodes (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      memory_id TEXT,
      workspace TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_graph_edges (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      workspace TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON memory_graph_edges(from_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON memory_graph_edges(to_id);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_memory ON memory_graph_nodes(memory_id);
  `);
  return db;
}

function initSqliteSync() {
  try {
    const { DatabaseSync } = require("node:sqlite");
    return openGraphDb(DatabaseSync);
  } catch {
    return null;
  }
}

async function initSqliteAsync() {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    return openGraphDb(DatabaseSync);
  } catch {
    return null;
  }
}

function ensureBackend() {
  if (backend) return backend;
  sqliteDb = initSqliteSync();
  if (sqliteDb) {
    backend = "sqlite";
    return backend;
  }
  jsonGraph = loadJsonGraph();
  backend = "json";
  return backend;
}

function loadJsonGraph() {
  ensureMemoryDirs();
  if (!fs.existsSync(GRAPH_JSON)) return { nodes: [], edges: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(GRAPH_JSON, "utf8"));
    return {
      nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
      edges: Array.isArray(raw.edges) ? raw.edges : [],
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

function saveJsonGraph() {
  fs.writeFileSync(GRAPH_JSON, JSON.stringify(jsonGraph, null, 2));
}

export function upsertGraphNode({ kind, label, memoryId = null, workspace = "" }) {
  ensureBackend();
  const node = {
    id: memoryId ? `mem:${memoryId}` : `node:${randomUUID()}`,
    kind: String(kind || "entity"),
    label: String(label || "").slice(0, 240),
    memory_id: memoryId || null,
    workspace: String(workspace || ""),
    created_at: new Date().toISOString(),
  };

  if (backend === "sqlite") {
    sqliteDb.prepare(`
      INSERT INTO memory_graph_nodes (id, kind, label, memory_id, workspace, created_at)
      VALUES (@id, @kind, @label, @memory_id, @workspace, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        label = excluded.label,
        workspace = excluded.workspace
    `).run({
      id: node.id,
      kind: node.kind,
      label: node.label,
      memory_id: node.memory_id,
      workspace: node.workspace,
      created_at: node.created_at,
    });
    return node;
  }

  const existing = jsonGraph.nodes.find((entry) => entry.id === node.id);
  if (existing) {
    Object.assign(existing, node);
  } else {
    jsonGraph.nodes.unshift(node);
  }
  saveJsonGraph();
  return node;
}

export function addGraphEdge({ fromId, toId, relation, workspace = "" }) {
  if (!fromId || !toId || fromId === toId) return null;
  ensureBackend();

  const edge = {
    id: randomUUID(),
    from_id: fromId,
    to_id: toId,
    relation: String(relation || "related_to"),
    workspace: String(workspace || ""),
    created_at: new Date().toISOString(),
  };

  if (backend === "sqlite") {
    sqliteDb.prepare(`
      INSERT INTO memory_graph_edges (id, from_id, to_id, relation, workspace, created_at)
      VALUES (@id, @from_id, @to_id, @relation, @workspace, @created_at)
    `).run(edge);
    return edge;
  }

  jsonGraph.edges.unshift(edge);
  saveJsonGraph();
  return edge;
}

export function getNeighbors(nodeId, { workspace = "", limit = 20 } = {}) {
  ensureBackend();
  if (!nodeId) return { nodes: [], edges: [] };

  if (backend === "sqlite") {
    const edges = sqliteDb.prepare(`
      SELECT * FROM memory_graph_edges
      WHERE (from_id = ? OR to_id = ?)
        AND (? = '' OR workspace = '' OR workspace = ?)
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `).all(nodeId, nodeId, workspace, workspace, limit);

    const nodeIds = new Set();
    for (const edge of edges) {
      nodeIds.add(edge.from_id);
      nodeIds.add(edge.to_id);
    }

    const nodes = [];
    for (const id of nodeIds) {
      const row = sqliteDb.prepare(`SELECT * FROM memory_graph_nodes WHERE id = ?`).get(id);
      if (row) nodes.push(row);
    }
    return { nodes, edges };
  }

  const edges = jsonGraph.edges
    .filter((edge) =>
      (edge.from_id === nodeId || edge.to_id === nodeId)
      && (!workspace || !edge.workspace || edge.workspace === workspace))
    .slice(0, limit);

  const nodeIds = new Set();
  for (const edge of edges) {
    nodeIds.add(edge.from_id);
    nodeIds.add(edge.to_id);
  }
  const nodes = jsonGraph.nodes.filter((node) => nodeIds.has(node.id));
  return { nodes, edges };
}

export function getGraphBackend() {
  ensureBackend();
  return backend;
}

export async function warmGraphBackend() {
  if (backend) return backend;
  sqliteDb = initSqliteSync();
  if (sqliteDb) {
    backend = "sqlite";
    return backend;
  }
  sqliteDb = await initSqliteAsync();
  if (sqliteDb) {
    backend = "sqlite";
    return backend;
  }
  jsonGraph = loadJsonGraph();
  backend = "json";
  return backend;
}
