// Установка плагинов: GitHub, локальная папка, URL-архив.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { PLUGINS_DIR, ensurePluginsDir } from "./paths.mjs";
import { isPluginRoot } from "./manifest.mjs";
import { installPluginFromDir } from "./registry.mjs";

export { installPluginFromDir, uninstallPlugin } from "./registry.mjs";

function parseGitHubRepo(repoUrl) {
  let repo = String(repoUrl || "").trim();
  if (repo.includes("github.com")) {
    const match = repo.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?(?:\/|$)/);
    if (match) repo = match[1];
  }
  if (!repo.includes("/")) throw new Error("Invalid GitHub repo URL");
  return repo;
}

function findPluginRoot(extractedDir) {
  if (isPluginRoot(extractedDir)) return extractedDir;

  const entries = fs.readdirSync(extractedDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(extractedDir, entry.name);
    if (isPluginRoot(candidate)) return candidate;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = findPluginRoot(path.join(extractedDir, entry.name));
    if (nested) return nested;
  }

  return null;
}

export async function installPluginFromGitHub(repoUrl, branch = "main") {
  ensurePluginsDir();
  const repo = parseGitHubRepo(repoUrl);
  const pluginId = repo.split("/")[1];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-plugin-"));

  try {
    execSync(`git clone --depth 1 --branch ${branch} https://github.com/${repo}.git "${tempDir}/repo"`, {
      stdio: "pipe",
    });
    const pluginRoot = findPluginRoot(path.join(tempDir, "repo"));
    if (!pluginRoot) throw new Error("No Codex/Claude plugin layout found in repository");
    return installPluginFromDir(pluginRoot, pluginId);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function installPluginFromPath(sourcePath) {
  const abs = path.resolve(String(sourcePath || ""));
  if (!fs.existsSync(abs)) throw new Error(`Path not found: ${abs}`);
  return installPluginFromDir(abs);
}

export async function installPluginFromUrl(url, pluginId = "") {
  ensurePluginsDir();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-plugin-dl-"));

  try {
    const archivePath = path.join(tempDir, "archive");
    execSync(`curl -L -o "${archivePath}" "${url}"`, { stdio: "pipe" });

    const extracted = path.join(tempDir, "extracted");
    fs.mkdirSync(extracted, { recursive: true });

    if (url.endsWith(".zip")) {
      execSync(`unzip -o "${archivePath}" -d "${extracted}"`, { stdio: "pipe" });
    } else if (url.endsWith(".tar.gz") || url.endsWith(".tgz")) {
      execSync(`tar -xzf "${archivePath}" -C "${extracted}"`, { stdio: "pipe" });
    } else {
      throw new Error("Unsupported archive format. Use .zip or .tar.gz");
    }

    const pluginRoot = findPluginRoot(extracted);
    if (!pluginRoot) throw new Error("No plugin root found in archive");
    return installPluginFromDir(pluginRoot, pluginId || undefined);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function getPluginsDir() {
  return PLUGINS_DIR;
}
