// Манифесты Codex (.codex-plugin) и Claude Code (.claude-plugin).

import fs from "node:fs";
import path from "node:path";

const MANIFEST_DIRS = [
  { dir: ".codex-plugin", file: "plugin.json", format: "codex" },
  { dir: ".claude-plugin", file: "plugin.json", format: "claude" },
];

export function detectPluginManifest(pluginRoot) {
  for (const spec of MANIFEST_DIRS) {
    const manifestPath = path.join(pluginRoot, spec.dir, spec.file);
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      return {
        format: spec.format,
        manifestPath,
        manifest,
        id: slugify(manifest.name || path.basename(pluginRoot)),
        name: manifest.name || path.basename(pluginRoot),
        version: manifest.version || "0.0.0",
        description: manifest.description || "",
        skillsPath: resolveSkillsPath(pluginRoot, manifest),
        commandsPath: resolveCommandsPath(pluginRoot, manifest),
      };
    } catch (error) {
      throw new Error(`Invalid plugin manifest ${manifestPath}: ${error.message}`);
    }
  }

  for (const legacy of ["codex.yaml", "codex.json"]) {
    const legacyPath = path.join(pluginRoot, legacy);
    if (!fs.existsSync(legacyPath)) continue;
    return {
      format: "codex-legacy",
      manifestPath: legacyPath,
      manifest: {},
      id: slugify(path.basename(pluginRoot)),
      name: path.basename(pluginRoot),
      version: "0.0.0",
      description: "",
      skillsPath: path.join(pluginRoot, "skills"),
      commandsPath: null,
    };
  }

  return null;
}

export function isPluginRoot(dirPath) {
  if (!fs.existsSync(dirPath)) return false;
  if (detectPluginManifest(dirPath)) return true;
  if (fs.existsSync(path.join(dirPath, "skills"))) return true;
  if (fs.existsSync(path.join(dirPath, "SKILL.md"))) return true;
  return false;
}

function resolvePathField(root, value, fallback = null) {
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === "string" && entry.trim());
    if (!first) return fallback;
    return path.join(root, first.replace(/^\.\//, ""));
  }
  if (!value || typeof value !== "string") return fallback;
  const trimmed = value.trim().replace(/^\.\//, "");
  return trimmed ? path.join(root, trimmed) : fallback;
}

function resolveSkillsPath(root, manifest) {
  return resolvePathField(root, manifest.skills, path.join(root, "skills"));
}

function resolveCommandsPath(root, manifest) {
  return resolvePathField(root, manifest.commands, null);
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
