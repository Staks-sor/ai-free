// Skill registry — builtins + user-installed skills in ~/.ai-free/skills/

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadSkillFromDir } from "./loader.mjs";
import { resolvePluginSkill, listPluginSkillsFlat, clearPluginCache } from "../plugins/registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTINS_DIR = path.join(__dirname, "builtins");
const USER_SKILLS_DIR = path.join(os.homedir(), ".ai-free", "skills");

const cache = new Map();

function ensureUserDir() {
  fs.mkdirSync(USER_SKILLS_DIR, { recursive: true });
}

function findSkillDir(skillId) {
  const id = String(skillId || "").trim();
  if (id.includes(":")) return null;

  const builtin = path.join(BUILTINS_DIR, id);
  if (fs.existsSync(builtin)) return builtin;

  const user = path.join(USER_SKILLS_DIR, id);
  if (fs.existsSync(user)) return user;

  return null;
}

function isBuiltin(skillId) {
  const baseId = String(skillId || "").split(":")[0];
  return fs.existsSync(path.join(BUILTINS_DIR, baseId));
}

export function loadSkill(skillId) {
  const id = String(skillId || "").trim();
  if (!id) throw new Error("Skill id is required");
  if (cache.has(id)) return cache.get(id);

  const pluginSkill = resolvePluginSkill(id);
  if (pluginSkill) {
    cache.set(id, pluginSkill);
    return pluginSkill;
  }

  const dir = findSkillDir(id);
  if (!dir) throw new Error(`Skill not found: ${id}`);

  const skill = loadSkillFromDir(dir, id);
  cache.set(id, skill);
  return skill;
}

export function listInstalledSkills() {
  const skills = [];
  const seen = new Set();

  const push = (skill) => {
    if (!skill?.id || seen.has(skill.id)) return;
    seen.add(skill.id);
    skills.push(skill);
  };

  for (const root of [BUILTINS_DIR, USER_SKILLS_DIR]) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || seen.has(entry.name)) continue;
      try {
        push(loadSkill(entry.name));
      } catch {
        // skip broken skill dirs
      }
    }
  }

  for (const skill of listPluginSkillsFlat()) push(skill);

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function installSkill(sourceDir, skillId) {
  ensureUserDir();
  const id = String(skillId || "").trim();
  if (!id) throw new Error("Skill id is required");

  const target = path.join(USER_SKILLS_DIR, id);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  copyDirRecursive(sourceDir, target);
  cache.delete(id);
  return loadSkill(id);
}

export function uninstallSkill(skillId) {
  const id = String(skillId || "").trim();
  if (!id || isBuiltin(id)) return false;
  if (id.includes(":")) return false;

  const target = path.join(USER_SKILLS_DIR, id);
  if (!fs.existsSync(target)) return false;

  fs.rmSync(target, { recursive: true, force: true });
  cache.delete(id);
  return true;
}

export function getSkillPrompt(skillId) {
  if (!skillId) return null;
  try {
    return loadSkill(skillId).prompt;
  } catch {
    return null;
  }
}

export function clearSkillCache() {
  cache.clear();
  clearPluginCache();
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
