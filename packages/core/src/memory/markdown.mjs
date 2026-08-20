// Markdown vault — человекочитаемые заметки с YAML frontmatter.

import fs from "node:fs";
import path from "node:path";
import { MEMORY_VAULT } from "./paths.mjs";

export function serializeFrontmatter(fields = {}) {
  const lines = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => JSON.stringify(String(v))).join(", ")}]`);
      continue;
    }
    if (typeof value === "object") {
      lines.push(`${key}: ${JSON.stringify(value)}`);
      continue;
    }
    lines.push(`${key}: ${String(value)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function parseFrontmatter(text) {
  const raw = String(text || "");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, content: raw.trim() };
  }

  const meta = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      try {
        meta[key] = JSON.parse(value.replace(/'/g, '"'));
      } catch {
        meta[key] = value.slice(1, -1).split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      }
      continue;
    }
    if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
      try { meta[key] = JSON.parse(value); continue; } catch {}
    }
    meta[key] = value;
  }

  return { meta, content: match[2].trim() };
}

export function writeMemoryMarkdown(item) {
  if (!item?.id) return null;
  fs.mkdirSync(MEMORY_VAULT, { recursive: true });
  const filePath = path.join(MEMORY_VAULT, `${item.id}.md`);
  const frontmatter = serializeFrontmatter({
    id: item.id,
    type: item.type,
    tags: item.tags || [],
    workspace: item.workspace || "",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
  fs.writeFileSync(filePath, `---\n${frontmatter}---\n\n${item.content || ""}\n`, "utf8");
  return filePath;
}

export function readMemoryMarkdown(id) {
  const filePath = path.join(MEMORY_VAULT, `${id}.md`);
  if (!fs.existsSync(filePath)) return null;
  const parsed = parseFrontmatter(fs.readFileSync(filePath, "utf8"));
  return normalizeVaultItem(parsed.meta, parsed.content);
}

export function deleteMemoryMarkdown(id) {
  const filePath = path.join(MEMORY_VAULT, `${id}.md`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

function normalizeVaultItem(meta, content) {
  return {
    id: String(meta.id || ""),
    type: String(meta.type || "note"),
    content: String(content || ""),
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    workspace: String(meta.workspace || ""),
    meta: {},
    createdAt: String(meta.createdAt || new Date().toISOString()),
    updatedAt: String(meta.updatedAt || meta.createdAt || new Date().toISOString()),
  };
}
