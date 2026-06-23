// Загрузка skill-манифеста из директории (native, Claude, Codex).

import fs from "node:fs";
import path from "node:path";
import { loadSkillMdFile } from "../plugins/skill-md.mjs";

export function loadSkillFromDir(dir, fallbackId = "") {
  const manifestPath = path.join(dir, "skill.json");
  if (fs.existsSync(manifestPath)) {
    return loadNativeSkill(dir, fallbackId, manifestPath);
  }

  const skillMdPath = path.join(dir, "SKILL.md");
  if (fs.existsSync(skillMdPath)) {
    return loadSkillMdFile(skillMdPath, { fallbackId: fallbackId || path.basename(dir) });
  }

  const claudePath = path.join(dir, "CLAUDE.md");
  if (fs.existsSync(claudePath)) {
    return loadClaudeSkill(dir, fallbackId, claudePath);
  }

  const codexYaml = path.join(dir, "codex.yaml");
  const codexJson = path.join(dir, "codex.json");
  if (fs.existsSync(codexYaml)) {
    return loadCodexSkill(dir, fallbackId, codexYaml, "yaml");
  }
  if (fs.existsSync(codexJson)) {
    return loadCodexSkill(dir, fallbackId, codexJson, "json");
  }

  throw new Error(`No skill manifest found in ${dir}`);
}

function loadNativeSkill(dir, fallbackId, manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const id = String(manifest.id || fallbackId || path.basename(dir)).trim();
  const promptFile = manifest.promptFile || "prompt.md";
  const promptPath = path.join(dir, promptFile);
  let prompt = "";

  if (fs.existsSync(promptPath)) {
    prompt = fs.readFileSync(promptPath, "utf8");
  } else if (typeof manifest.prompt === "string") {
    prompt = manifest.prompt;
  }

  if (!prompt.trim()) {
    throw new Error(`Skill ${id} has no prompt (${promptFile})`);
  }

  return {
    id,
    name: manifest.name || id,
    description: manifest.description || "",
    version: manifest.version || "0.0.0",
    prompt: prompt.trim(),
    commands: Array.isArray(manifest.commands) ? manifest.commands : [],
    permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
    source: dir,
    format: "native",
  };
}

function loadClaudeSkill(dir, fallbackId, claudePath) {
  const id = String(fallbackId || path.basename(dir)).trim();
  const prompt = fs.readFileSync(claudePath, "utf8").trim();
  if (!prompt) throw new Error(`Skill ${id} CLAUDE.md is empty`);

  return {
    id,
    name: id,
    description: "Imported Claude skill",
    version: "0.0.0",
    prompt,
    commands: [],
    permissions: [],
    source: dir,
    format: "claude",
  };
}

function loadCodexSkill(dir, fallbackId, manifestPath, kind) {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const manifest = kind === "json" ? JSON.parse(raw) : parseSimpleYaml(raw);
  const id = String(manifest.id || manifest.name || fallbackId || path.basename(dir)).trim();

  const instructionsFile = manifest.instructionsFile || manifest.promptFile;
  let prompt = String(manifest.instructions || manifest.prompt || manifest.system || "").trim();
  if (!prompt && instructionsFile) {
    const filePath = path.join(dir, instructionsFile);
    if (fs.existsSync(filePath)) prompt = fs.readFileSync(filePath, "utf8").trim();
  }

  if (!prompt) {
    throw new Error(`Skill ${id} Codex manifest has no instructions`);
  }

  return {
    id,
    name: manifest.name || id,
    description: manifest.description || "",
    version: manifest.version || "0.0.0",
    prompt,
    commands: Array.isArray(manifest.tools) ? manifest.tools : [],
    permissions: [],
    source: dir,
    format: "codex",
  };
}

function parseSimpleYaml(text) {
  const result = {};
  for (const line of String(text || "").split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    result[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return result;
}
