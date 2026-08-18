// Пути хранилища памяти (~/.ai-free/memory/).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MEMORY_BASE = process.env.AI_FREE_MEMORY_DIR
  ? path.resolve(process.env.AI_FREE_MEMORY_DIR)
  : path.join(os.homedir(), ".ai-free", "memory");

export const MEMORY_DB = path.join(MEMORY_BASE, "memory.db");
export const MEMORY_VAULT = path.join(MEMORY_BASE, "vault");
export const LEGACY_INDEX = path.join(MEMORY_BASE, "index.json");
export const MIGRATION_FLAG = path.join(MEMORY_BASE, ".migrated-v2.json");

export function ensureMemoryDirs() {
  fs.mkdirSync(MEMORY_BASE, { recursive: true });
  fs.mkdirSync(MEMORY_VAULT, { recursive: true });
}
