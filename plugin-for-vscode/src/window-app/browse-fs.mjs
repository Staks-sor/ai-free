// Листинг папок для модалки «Новый чат» (/api/browse).
// withFileTypes + isDirectory() на macOS/Windows не всегда видит symlink → каталог.

import fs from "node:fs";
import path from "node:path";

export const BROWSE_DIR_LIMIT = 2000;

export function isDirectoryEntry(entry, parentDir) {
  try {
    if (entry.isDirectory()) return true;
  } catch {
    // ignore
  }
  const fullPath = path.join(parentDir, entry.name);
  try {
    const stat = fs.lstatSync(fullPath);
    if (stat.isDirectory()) return true;
    if (stat.isSymbolicLink()) {
      return fs.statSync(fullPath).isDirectory();
    }
  } catch {
    return false;
  }
  return false;
}

export function listBrowseDirectories(targetPath, { showHidden = false, limit = BROWSE_DIR_LIMIT } = {}) {
  const target = path.resolve(targetPath);
  if (!fs.existsSync(target)) {
    throw Object.assign(new Error(`Папка не существует: ${target}`), { code: "ENOENT" });
  }
  if (!fs.statSync(target).isDirectory()) {
    throw Object.assign(new Error(`Не папка: ${target}`), { code: "ENOTDIR" });
  }

  let raw;
  try {
    raw = fs.readdirSync(target, { withFileTypes: true });
  } catch (error) {
    throw Object.assign(new Error(`Не могу прочитать папку: ${error.message}`), { code: "EACCES" });
  }

  const allDirs = [];
  for (const entry of raw) {
    if (!showHidden && entry.name.startsWith(".")) continue;
    if (!isDirectoryEntry(entry, target)) continue;
    allDirs.push({
      name: entry.name,
      path: path.join(target, entry.name),
    });
  }

  allDirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const parent = path.dirname(target);
  return {
    path: target,
    parent: parent !== target ? parent : null,
    entries: allDirs.slice(0, limit),
    totalDirectories: allDirs.length,
    truncated: allDirs.length > limit,
  };
}
