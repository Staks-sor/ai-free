// Обнаружение skills внутри плагина или standalone-директории.

import fs from "node:fs";
import path from "node:path";
import { loadSkillFromDir } from "../skills/loader.mjs";
import { findSkillMdFiles, loadSkillMdFile } from "./skill-md.mjs";
import { detectPluginManifest } from "./manifest.mjs";

export function discoverSkillsInTree(rootDir, { pluginId = null, pluginMeta = null } = {}) {
  const skills = [];
  const seen = new Set();

  const add = (skill) => {
    if (!skill?.id || seen.has(skill.id)) return;
    seen.add(skill.id);
    skills.push(skill);
  };

  const manifest = pluginMeta || detectPluginManifest(rootDir);

  if (manifest) {
    const skillRoots = [];
    if (manifest.skillsPath && fs.existsSync(manifest.skillsPath)) {
      skillRoots.push(manifest.skillsPath);
    }
    if (manifest.commandsPath && fs.existsSync(manifest.commandsPath)) {
      loadLegacyCommands(manifest.commandsPath, pluginId || manifest.id).forEach(add);
    }
    for (const skillsRoot of skillRoots) {
      for (const skillMd of findSkillMdFiles(skillsRoot, { maxDepth: 4 })) {
        try {
          add(loadSkillMdFile(skillMd, {
            fallbackId: path.basename(path.dirname(skillMd)),
            pluginId: pluginId || manifest.id,
          }));
        } catch {
          // skip broken skill
        }
      }
    }

    const rootSkillMd = path.join(rootDir, "SKILL.md");
    if (fs.existsSync(rootSkillMd)) {
      try {
        add(loadSkillMdFile(rootSkillMd, { pluginId: pluginId || manifest.id }));
      } catch {
        // skip
      }
    }
  }

  // Standalone layouts (single skill dir or skill.json)
  if (!skills.length) {
    try {
      add({ ...loadSkillFromDir(rootDir), pluginId: pluginId || null });
    } catch {
      for (const skillMd of findSkillMdFiles(rootDir, { maxDepth: 3 })) {
        try {
          add(loadSkillMdFile(skillMd, {
            fallbackId: path.basename(path.dirname(skillMd)),
            pluginId,
          }));
        } catch {
          // skip
        }
      }
    }
  }

  return skills;
}

function loadLegacyCommands(commandsDir, pluginId) {
  if (!fs.existsSync(commandsDir)) return [];
  const skills = [];
  for (const entry of fs.readdirSync(commandsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const name = entry.name.replace(/\.md$/i, "");
    const content = fs.readFileSync(path.join(commandsDir, entry.name), "utf8").trim();
    if (!content) continue;
    const id = pluginId ? `${pluginId}:${name}` : name;
    skills.push({
      id,
      pluginId,
      skillName: name,
      name,
      description: "Imported Claude command",
      version: "0.0.0",
      prompt: content,
      commands: [],
      permissions: [],
      source: path.join(commandsDir, entry.name),
      format: "claude-command",
    });
  }
  return skills;
}
