// Memory Store — публичный API поверх SQLite FTS + Markdown vault.

import {
  deleteMemoryItem,
  getMemoryItem,
  insertMemoryItem,
  searchMemoryItems,
} from "./db.mjs";

function isImportantMemory({ type, content = "", tags = [], meta = {} }) {
  const text = String(content).toLowerCase();

  if (Array.isArray(tags) && tags.length > 0) return true;

  const keywords = [
    "error", "fix", "fixed", "bug", "crash", "exception", "stack",
    "implement", "update", "change", "remove", "delete", "install",
    "config", "fail", "issue",
  ];

  if (keywords.some((k) => text.includes(k))) return true;
  if (meta?.important === true) return true;

  return false;
}

export function addMemory({ type = "note", content = "", tags = [], workspace = "", meta = {} }) {
  if (!isImportantMemory({ type, content, tags, meta })) return null;
  return insertMemoryItem({ type, content, tags, workspace, meta });
}

export function searchMemory(query = "", workspace = "") {
  return searchMemoryItems(query, workspace, 20);
}

export function deleteMemory(id) {
  return deleteMemoryItem(id);
}

export function getMemoryById(id) {
  return getMemoryItem(id);
}

export function extractFromToolLogs(task, toolLogs = [], workspace = "") {
  let saved = 0;

  for (const log of toolLogs) {
    if (!log) continue;
    const text = String(log);

    const hasError = text.includes("error") || text.includes("Error");
    const hasFile = text.includes("write_file") || text.includes("read_file");
    const hasCmd = text.includes("run_command") || text.includes("run_shell");

    if (!hasError && !hasFile && !hasCmd) continue;

    const item = addMemory({
      type: hasError ? "error" : "execution",
      content: `${task}\n---\n${text.slice(0, 800)}`,
      tags: hasError ? ["error", "agent"] : ["execution", "agent"],
      workspace,
      meta: { important: true },
    });
    if (item) saved += 1;
  }

  return saved;
}

export { getMemoryBackend, warmMemoryBackend } from "./db.mjs";
