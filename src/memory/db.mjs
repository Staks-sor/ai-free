// SQLite FTS5 backend + JSON fallback для Node < 22.

import fs from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { LEGACY_INDEX, MEMORY_DB, MIGRATION_FLAG, ensureMemoryDirs } from "./paths.mjs";
import { deleteMemoryMarkdown, writeMemoryMarkdown } from "./markdown.mjs";
import { buildFtsMatchQuery, rankFtsResults } from "./search/fts-query.mjs";
import { listRecentItems, searchKeywordItems } from "./search/keyword.mjs";
import { mergeHybridResults } from "./search/hybrid.mjs";
import { rankByVector, serializeVector, vectorizeItem } from "./search/vector.mjs";

const require = createRequire(import.meta.url);

let sqliteDb = null;
let jsonItems = null;
let backend = null;

export function resetMemoryBackendForTests() {
  sqliteDb = null;
  jsonItems = null;
  backend = null;
}

function normalizeItem(raw = {}) {
  return {
    id: String(raw.id || randomUUID()),
    type: String(raw.type || "note"),
    content: String(raw.content || ""),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    workspace: String(raw.workspace || ""),
    meta: raw.meta && typeof raw.meta === "object" ? raw.meta : {},
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
  };
}

function parseTags(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseMeta(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function rowToItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    tags: parseTags(row.tags),
    workspace: row.workspace || "",
    meta: parseMeta(row.meta),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function openSqliteDb(DatabaseSync) {
  ensureMemoryDirs();
  const db = new DatabaseSync(MEMORY_DB);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      workspace TEXT NOT NULL DEFAULT '',
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      id UNINDEXED,
      type,
      content,
      tags,
      workspace,
      tokenize='unicode61'
    );
    CREATE TABLE IF NOT EXISTS memory_vectors (
      id TEXT PRIMARY KEY,
      vec TEXT NOT NULL
    );
  `);
  migrateLegacyJson(db);
  return db;
}

function initSqliteSync() {
  try {
    const sqlite = require("node:sqlite");
    return openSqliteDb(sqlite.DatabaseSync);
  } catch {
    return null;
  }
}

async function initSqliteAsync() {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    return openSqliteDb(DatabaseSync);
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

  jsonItems = loadJsonItems();
  backend = "json";
  return backend;
}

function loadJsonItems() {
  ensureMemoryDirs();
  if (!fs.existsSync(LEGACY_INDEX)) return [];
  try {
    const index = JSON.parse(fs.readFileSync(LEGACY_INDEX, "utf8"));
    return Array.isArray(index.items) ? index.items.map(normalizeItem) : [];
  } catch {
    return [];
  }
}

function saveJsonItems(items) {
  ensureMemoryDirs();
  fs.writeFileSync(LEGACY_INDEX, JSON.stringify({ items }, null, 2));
}

function migrateLegacyJson(db) {
  if (fs.existsSync(MIGRATION_FLAG)) return;

  const legacy = loadJsonItems();
  if (!legacy.length) {
    fs.writeFileSync(MIGRATION_FLAG, JSON.stringify({ migratedAt: new Date().toISOString(), count: 0 }));
    return;
  }

  for (const item of legacy) {
    upsertSqliteItem(db, normalizeItem(item));
    writeMemoryMarkdown(normalizeItem(item));
  }

  fs.writeFileSync(MIGRATION_FLAG, JSON.stringify({
    migratedAt: new Date().toISOString(),
    count: legacy.length,
    source: LEGACY_INDEX,
  }));
}

function upsertSqliteItem(db, item) {
  db.prepare(`
    INSERT INTO memory_items (id, type, content, tags, workspace, meta, created_at, updated_at)
    VALUES (@id, @type, @content, @tags, @workspace, @meta, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      content = excluded.content,
      tags = excluded.tags,
      workspace = excluded.workspace,
      meta = excluded.meta,
      updated_at = excluded.updated_at
  `).run({
    id: item.id,
    type: item.type,
    content: item.content,
    tags: JSON.stringify(item.tags),
    workspace: item.workspace,
    meta: JSON.stringify(item.meta),
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  });

  db.prepare(`DELETE FROM memory_fts WHERE id = ?`).run(item.id);
  db.prepare(`
    INSERT INTO memory_fts (id, type, content, tags, workspace)
    VALUES (?, ?, ?, ?, ?)
  `).run(item.id, item.type, item.content, item.tags.join(" "), item.workspace);
}

function upsertItemVector(db, item) {
  const vec = serializeVector(vectorizeItem(item));
  db.prepare(`
    INSERT INTO memory_vectors (id, vec)
    VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET vec = excluded.vec
  `).run(item.id, vec);
}

function deleteItemVector(db, id) {
  db.prepare(`DELETE FROM memory_vectors WHERE id = ?`).run(String(id));
}

function loadVectorMap(db, workspace = "", limit = 200) {
  const rows = workspace
    ? db.prepare(`
        SELECT v.id, v.vec
        FROM memory_vectors v
        JOIN memory_items i ON i.id = v.id
        WHERE i.workspace = '' OR i.workspace = ?
        ORDER BY datetime(i.updated_at) DESC
        LIMIT ?
      `).all(workspace, limit)
    : db.prepare(`
        SELECT v.id, v.vec
        FROM memory_vectors v
        JOIN memory_items i ON i.id = v.id
        ORDER BY datetime(i.updated_at) DESC
        LIMIT ?
      `).all(limit);

  const map = new Map();
  for (const row of rows) map.set(row.id, row.vec);
  return map;
}

function attachVectorsToItems(items, vectorMap) {
  return items.map((item) => {
    const vec = vectorMap.get(item.id) || item.meta?.embedding;
    return vec ? { ...item, _vector: vec } : item;
  });
}

export function insertMemoryItem(rawItem) {
  const item = normalizeItem(rawItem);
  const vec = serializeVector(vectorizeItem(item));
  item.meta = { ...item.meta, embedding: vec };
  ensureBackend();

  if (backend === "sqlite") {
    upsertSqliteItem(sqliteDb, item);
    upsertItemVector(sqliteDb, item);
  } else {
    jsonItems = [item, ...jsonItems.filter((entry) => entry.id !== item.id)];
    saveJsonItems(jsonItems);
  }

  writeMemoryMarkdown(item);
  return item;
}

export function getMemoryItem(id) {
  ensureBackend();
  if (backend === "sqlite") {
    const row = sqliteDb.prepare(`SELECT * FROM memory_items WHERE id = ?`).get(String(id));
    return rowToItem(row);
  }
  return jsonItems.find((entry) => entry.id === id) || null;
}

export function deleteMemoryItem(id) {
  ensureBackend();
  const target = String(id);

  if (backend === "sqlite") {
    const result = sqliteDb.prepare(`DELETE FROM memory_items WHERE id = ?`).run(target);
    sqliteDb.prepare(`DELETE FROM memory_fts WHERE id = ?`).run(target);
    deleteItemVector(sqliteDb, target);
    deleteMemoryMarkdown(target);
    return result.changes > 0;
  }

  const before = jsonItems.length;
  jsonItems = jsonItems.filter((entry) => entry.id !== target);
  if (jsonItems.length !== before) {
    saveJsonItems(jsonItems);
    deleteMemoryMarkdown(target);
    return true;
  }
  return false;
}

export function searchMemoryItems(query = "", workspace = "", limit = 20) {
  ensureBackend();
  const q = String(query || "").trim();

  if (!q) {
    if (backend === "sqlite") return listRecentSqlite(workspace, limit);
    return listRecentItems(jsonItems, workspace, limit);
  }

  if (backend === "sqlite") {
    return searchHybridSqlite(q, workspace, limit);
  }

  return searchHybridJson(q, workspace, limit);
}

function searchHybridSqlite(query, workspace, limit) {
  const ftsItems = searchSqlite(query, workspace, limit * 2);
  const vectorMap = loadVectorMap(sqliteDb, workspace, 200);
  const pool = attachVectorsToItems(listRecentSqlite(workspace, 200), vectorMap);
  const vectorItems = rankByVector(pool, query, { limit: limit * 2 });
  return mergeHybridResults(ftsItems, vectorItems, { limit });
}

function searchHybridJson(query, workspace, limit) {
  let pool = Array.isArray(jsonItems) ? [...jsonItems] : [];
  if (workspace) {
    pool = pool.filter((item) => !item.workspace || item.workspace === workspace);
  }
  const ftsItems = searchKeywordItems(pool, query, workspace, limit * 2);
  const vectorItems = rankByVector(pool, query, { limit: limit * 2 });
  return mergeHybridResults(ftsItems, vectorItems, { limit });
}

function listRecentSqlite(workspace, limit) {
  const rows = workspace
    ? sqliteDb.prepare(`
        SELECT * FROM memory_items
        WHERE workspace = '' OR workspace = ?
        ORDER BY datetime(updated_at) DESC
        LIMIT ?
      `).all(workspace, limit)
    : sqliteDb.prepare(`
        SELECT * FROM memory_items
        ORDER BY datetime(updated_at) DESC
        LIMIT ?
      `).all(limit);
  return rows.map(rowToItem);
}

function searchSqlite(query, workspace, limit) {
  const match = buildFtsMatchQuery(query);
  if (!match) return listRecentSqlite(workspace, limit);

  let rows;
  try {
    rows = workspace
      ? sqliteDb.prepare(`
          SELECT i.*
          FROM memory_fts f
          JOIN memory_items i ON i.id = f.id
          WHERE memory_fts MATCH ?
            AND (i.workspace = '' OR i.workspace = ?)
          LIMIT ?
        `).all(match, workspace, limit * 2)
      : sqliteDb.prepare(`
          SELECT i.*
          FROM memory_fts f
          JOIN memory_items i ON i.id = f.id
          WHERE memory_fts MATCH ?
          LIMIT ?
        `).all(match, limit * 2);
  } catch {
    return searchKeywordItems(listRecentSqlite("", 200), query, workspace, limit);
  }

  return rankFtsResults(rows.map(rowToItem), query).slice(0, limit);
}

export function getMemoryBackend() {
  ensureBackend();
  return backend;
}

export async function warmMemoryBackend() {
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
  jsonItems = loadJsonItems();
  backend = "json";
  return backend;
}
