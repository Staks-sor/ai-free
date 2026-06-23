// Marketplace integration — загрузка скиллов из удалённых источников
// Поддерживает: GitHub, npm, прямые URL

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { loadSkill, installSkill } from "./registry.mjs";
import { isPluginRoot } from "../plugins/manifest.mjs";

const SKILLS_DIR = path.join(os.homedir(), ".ai-free", "skills");

function ensureSkillsDir() {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
}

// Загрузка скилла или плагина из GitHub репозитория
export async function installFromGitHub(repoUrl, branch = "main") {
  ensureSkillsDir();

  let repo = repoUrl;
  if (repoUrl.includes("github.com")) {
    const match = repoUrl.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?(?:\/|$)/);
    if (match) repo = match[1];
  }

  const tempDir = path.join(SKILLS_DIR, ".temp-detect");
  fs.mkdirSync(tempDir, { recursive: true });
  const cloneTarget = path.join(tempDir, "repo");

  try {
    execSync(`git clone --depth 1 --branch ${branch} https://github.com/${repo}.git "${cloneTarget}"`, {
      stdio: "pipe",
    });

    const pluginRoot = findPluginDirectory(cloneTarget);
    if (pluginRoot && isPluginRoot(pluginRoot)) {
      const { installPluginFromDir } = await import("../plugins/registry.mjs");
      fs.rmSync(tempDir, { recursive: true, force: true });
      return installPluginFromDir(pluginRoot, repo.split("/")[1]);
    }

    const skillDir = findSkillDirectory(cloneTarget);
    if (!skillDir) throw new Error("No skill or plugin layout found in repository");

    const skillId = repo.split("/")[1];
    const targetPath = path.join(SKILLS_DIR, skillId);
    if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
    copyDirRecursive(skillDir, targetPath);
    fs.rmSync(tempDir, { recursive: true, force: true });
    return loadSkill(skillId);
  } catch (error) {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`Failed to install from GitHub: ${error.message}`);
  }
}

export async function installFromPath(sourcePath) {
  ensureSkillsDir();
  const abs = path.resolve(String(sourcePath || ""));
  if (!fs.existsSync(abs)) throw new Error(`Path not found: ${abs}`);

  if (isPluginRoot(abs)) {
    const { installPluginFromDir } = await import("../plugins/registry.mjs");
    return installPluginFromDir(abs);
  }

  const skillId = path.basename(abs);
  return installSkill(abs, skillId);
}

// Обновление скилла из GitHub
export async function updateFromGitHub(skillId) {
  const skillPath = path.join(SKILLS_DIR, skillId);
  
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Skill ${skillId} not found`);
  }
  
  try {
    execSync("git pull", { cwd: skillPath, stdio: "pipe" });
    return loadSkill(skillId);
  } catch (error) {
    throw new Error(`Failed to update skill: ${error.message}`);
  }
}

// Загрузка скилла из npm пакета
export async function installFromNpm(packageName) {
  ensureSkillsDir();
  
  try {
    // Устанавливаем пакет во временную директорию
    const tempDir = path.join(SKILLS_DIR, ".temp-npm");
    fs.mkdirSync(tempDir, { recursive: true });
    
    execSync(`npm install ${packageName}`, { cwd: tempDir, stdio: "pipe" });
    
    // Находим установленный пакет
    const packagePath = path.join(tempDir, "node_modules", packageName);
    if (!fs.existsSync(packagePath)) {
      throw new Error(`Package ${packageName} not found after installation`);
    }
    
    // Копируем в skills директорию
    const skillId = packageName.replace(/^@[^/]+\//, ""); // убираем scope
    const targetPath = path.join(SKILLS_DIR, skillId);
    
    copyDirRecursive(packagePath, targetPath);
    
    // Очищаем temp
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    return loadSkill(skillId);
  } catch (error) {
    throw new Error(`Failed to install from npm: ${error.message}`);
  }
}

// Загрузка скилла по прямому URL (zip/tar.gz)
export async function installFromUrl(url, skillId) {
  ensureSkillsDir();
  
  const tempDir = path.join(SKILLS_DIR, ".temp-download");
  fs.mkdirSync(tempDir, { recursive: true });
  
  try {
    const archivePath = path.join(tempDir, "archive");
    
    // Скачиваем файл
    execSync(`curl -L -o "${archivePath}" "${url}"`, { stdio: "pipe" });
    
    // Определяем формат и распаковываем
    if (url.endsWith(".zip")) {
      execSync(`unzip -o "${archivePath}" -d "${tempDir}/extracted"`, { stdio: "pipe" });
    } else if (url.endsWith(".tar.gz") || url.endsWith(".tgz")) {
      fs.mkdirSync(`${tempDir}/extracted`, { recursive: true });
      execSync(`tar -xzf "${archivePath}" -C "${tempDir}/extracted"`, { stdio: "pipe" });
    } else {
      throw new Error("Unsupported archive format. Use .zip or .tar.gz");
    }
    
    // Находим распакованную директорию со скиллом
    const extractedPath = findSkillDirectory(`${tempDir}/extracted`);
    if (!extractedPath) {
      throw new Error("Could not find skill directory in archive");
    }
    
    // Копируем в skills
    const targetPath = path.join(SKILLS_DIR, skillId);
    copyDirRecursive(extractedPath, targetPath);
    
    return loadSkill(skillId);
  } finally {
    // Очищаем temp
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

// Поиск marketplace скиллов на GitHub
export async function searchMarketplace(query) {
  // Используем GitHub API для поиска репозиториев с тегом ai-free-skill
  try {
    const response = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}+topic:ai-free-skill&sort=stars&order=desc`
    );
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    return data.items.map(repo => ({
      id: repo.name,
      name: repo.name,
      description: repo.description || "",
      url: repo.html_url,
      stars: repo.stargazers_count,
      author: repo.owner.login,
      installCommand: `installFromGitHub('${repo.full_name}')`,
    }));
  } catch (error) {
    throw new Error(`Failed to search marketplace: ${error.message}`);
  }
}

// Вспомогательные функции

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function findSkillDirectory(dirPath) {
  // Ищем директорию с skill.json, codex.yaml или CLAUDE.md
  if (!fs.existsSync(dirPath)) return null;
  
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  
  // Проверяем саму директорию
  if (hasSkillManifest(dirPath)) {
    return dirPath;
  }
  
  // Ищем в поддиректориях
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subPath = path.join(dirPath, entry.name);
      if (hasSkillManifest(subPath)) {
        return subPath;
      }
      
      // Рекурсивно ищем глубже
      const found = findSkillDirectory(subPath);
      if (found) return found;
    }
  }
  
  return null;
}

function findPluginDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return null;
  if (isPluginRoot(dirPath)) return dirPath;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const found = findPluginDirectory(path.join(dirPath, entry.name));
    if (found) return found;
  }
  return null;
}

function hasSkillManifest(dirPath) {
  return (
    fs.existsSync(path.join(dirPath, "skill.json")) ||
    fs.existsSync(path.join(dirPath, "SKILL.md")) ||
    fs.existsSync(path.join(dirPath, "codex.yaml")) ||
    fs.existsSync(path.join(dirPath, "codex.json")) ||
    fs.existsSync(path.join(dirPath, "CLAUDE.md"))
  );
}
