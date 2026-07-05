// SKILL.md — формат Codex / Claude Code / Cursor.

import fs from "node:fs";
import { parseFrontmatter } from "../memory/markdown.mjs";

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function parseAllowedTools(meta = {}) {
  const raw = meta["allowed-tools"] ?? meta.allowedTools ?? meta.tools;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return trimmed.slice(1, -1).split(",").map((v) => v.trim()).filter(Boolean);
      }
    }
    return trimmed.split(/[\s,]+/).filter(Boolean);
  }
  return [];
}

export function loadSkillMdFile(skillMdPath, { fallbackId = "", pluginId = null } = {}) {
  const raw = fs.readFileSync(skillMdPath, "utf8");
  const { meta, content } = parseFrontmatter(raw);
  const skillName = slugify(meta.name || fallbackId || skillMdPath.split("/").slice(-2, -1)[0]);
  const id = pluginId ? `${pluginId}:${skillName}` : skillName;
  const prompt = String(content || "").trim();

  if (!prompt && !meta.description) {
    throw new Error(`SKILL.md is empty: ${skillMdPath}`);
  }

  return {
    id,
    pluginId,
    skillName,
    name: meta.name || skillName,
    description: meta.description || "",
    version: meta.version || "0.0.0",
    prompt: prompt || String(meta.description || "").trim(),
    commands: parseAllowedTools(meta),
    permissions: [],
    source: skillMdPath,
    format: pluginId ? "plugin-skill" : "skill-md",
  };
}

export function findSkillMdFiles(rootDir, { maxDepth = 6 } = {}) {
  const found = [];
  walk(rootDir, 0);
  return found;

  function walk(dir, depth) {
    if (depth > maxDepth || !fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = `${dir}/${entry.name}`;
      if (entry.isFile() && entry.name === "SKILL.md") {
        found.push(full);
        continue;
      }
      if (entry.isDirectory()) walk(full, depth + 1);
    }
  }
}
