// Реестр установленных плагинов Codex / Claude Code.

import fs from "node:fs";
import path from "node:path";
import { PLUGINS_DIR, ensurePluginsDir } from "./paths.mjs";
import { detectPluginManifest, isPluginRoot } from "./manifest.mjs";
import { discoverSkillsInTree } from "./discover.mjs";
import { loadSkillMdFile } from "./skill-md.mjs";

const pluginCache = new Map();
const skillCache = new Map();

export function clearPluginCache() {
  pluginCache.clear();
  skillCache.clear();
}

export function listPluginRoots() {
  ensurePluginsDir();
  return fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(PLUGINS_DIR, entry.name));
}

export function loadPlugin(pluginRoot) {
  const cached = pluginCache.get(pluginRoot);
  if (cached) return cached;

  const manifest = detectPluginManifest(pluginRoot);
  const id = manifest?.id || path.basename(pluginRoot);
  const skills = discoverSkillsInTree(pluginRoot, { pluginId: id, pluginMeta: manifest });
  for (const skill of skills) skillCache.set(skill.id, skill);

  const plugin = {
    id,
    name: manifest?.name || id,
    version: manifest?.version || "0.0.0",
    description: manifest?.description || "",
    format: manifest?.format || "bundle",
    source: pluginRoot,
    skillIds: skills.map((skill) => skill.id),
    skills,
  };

  pluginCache.set(pluginRoot, plugin);
  return plugin;
}

export function listInstalledPlugins() {
  return listPluginRoots()
    .map((root) => {
      try {
        return loadPlugin(root);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listPluginSkillsFlat() {
  const skills = [];
  const seen = new Set();
  for (const plugin of listInstalledPlugins()) {
    for (const skill of plugin.skills) {
      if (seen.has(skill.id)) continue;
      seen.add(skill.id);
      skills.push(skill);
    }
  }
  return skills;
}

export function getPlugin(pluginId) {
  const id = String(pluginId || "").trim();
  const root = path.join(PLUGINS_DIR, id);
  if (!fs.existsSync(root)) return null;
  return loadPlugin(root);
}

export function resolvePluginSkill(skillId) {
  if (skillCache.has(skillId)) return skillCache.get(skillId);

  const text = String(skillId || "");
  if (!text.includes(":")) return null;

  const [pluginId, skillName] = text.split(":", 2);
  const plugin = getPlugin(pluginId);
  if (!plugin) return null;

  const found = plugin.skills.find((skill) => skill.id === text || skill.skillName === skillName);
  if (found) {
    skillCache.set(text, found);
    return found;
  }

  const skillDir = path.join(plugin.source, "skills", skillName);
  const skillMd = path.join(skillDir, "SKILL.md");
  if (fs.existsSync(skillMd)) {
    const loaded = loadSkillMdFile(skillMd, { fallbackId: skillName, pluginId });
    skillCache.set(text, loaded);
    return loaded;
  }

  return null;
}

export function installPluginFromDir(sourceDir, preferredId = "") {
  ensurePluginsDir();
  const absSource = path.resolve(sourceDir);
  if (!isPluginRoot(absSource)) {
    throw new Error("Directory is not a Codex/Claude plugin or skill bundle");
  }

  const manifest = detectPluginManifest(absSource);
  const pluginId = String(preferredId || manifest?.id || path.basename(absSource)).trim();
  const target = path.join(PLUGINS_DIR, pluginId);

  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  copyDirRecursive(absSource, target);
  clearPluginCache();
  return loadPlugin(target);
}

export function uninstallPlugin(pluginId) {
  const id = String(pluginId || "").trim();
  const target = path.join(PLUGINS_DIR, id);
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  clearPluginCache();
  return true;
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}
