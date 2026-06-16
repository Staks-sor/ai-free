// Memory Store MVP (AI Free)
// Простое локальное хранилище памяти без зависимостей
// Позже можно заменить на SQLite FTS / vector DB

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const BASE_DIR = path.join(os.homedir(), ".ai-free", "memory");
const INDEX_FILE = path.join(BASE_DIR, "index.json");

function ensureDir() {
  fs.mkdirSync(BASE_DIR, { recursive: true });
}

function loadIndex() {
  ensureDir();
  if (!fs.existsSync(INDEX_FILE)) return { items: [] };
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  } catch {
    return { items: [] };
  }
}

function saveIndex(index) {
  ensureDir();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

export function addMemory({ type = "note", content = "", tags = [], workspace = "", meta = {} }) {
  const index = loadIndex();

  const item = {
    id: randomUUID(),
    type,
    content,
    tags,
    workspace,
    meta,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  index.items.unshift(item);
  saveIndex(index);

  return item;
}

export function searchMemory(query = "") {
  const index = loadIndex();
  const q = String(query).toLowerCase().trim();

  if (!q) return index.items.slice(0, 20);

  return index.items
    .filter((item) => {
      return (
        item.content.toLowerCase().includes(q) ||
        item.tags?.some((t) => t.toLowerCase().includes(q)) ||
        item.workspace?.toLowerCase().includes(q)
      );
    })
    .slice(0, 20);
}

export function deleteMemory(id) {
  const index = loadIndex();
  const before = index.items.length;
  index.items = index.items.filter((i) => i.id !== id);
  saveIndex(index);
  return index.items.length !== before;
}

export function getMemoryById(id) {
  const index = loadIndex();
  return index.items.find((i) => i.id === id) || null;
}
