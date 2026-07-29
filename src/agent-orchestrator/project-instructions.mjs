import fs from "node:fs";
import path from "node:path";

const DEFAULT_MAX_FILES = 32;
const DEFAULT_MAX_FILE_BYTES = 64 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024;
const DEFAULT_MAX_DIRECTORIES = 2_000;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".next",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

export function loadProjectInstructions(workspaceRoot, options = {}) {
  const root = path.resolve(String(workspaceRoot || ""));
  const maxFiles = positiveInteger(options.maxFiles, DEFAULT_MAX_FILES);
  const maxFileBytes = positiveInteger(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
  const maxTotalBytes = positiveInteger(options.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES);
  const maxDirectories = positiveInteger(options.maxDirectories, DEFAULT_MAX_DIRECTORIES);
  const files = [];
  let totalBytes = 0;
  let visitedDirectories = 0;
  let truncated = false;

  if (!workspaceRoot || !isDirectory(root)) {
    return { context: "", files, truncated };
  }

  const visit = (directory) => {
    if (
      files.length >= maxFiles
      || totalBytes >= maxTotalBytes
      || visitedDirectories >= maxDirectories
    ) {
      truncated = true;
      return;
    }
    visitedDirectories += 1;

    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    const agentsFile = entries.find((entry) => entry.isFile() && entry.name === "AGENTS.md");
    if (agentsFile) {
      const absolutePath = path.join(directory, agentsFile.name);
      const remainingBytes = maxTotalBytes - totalBytes;
      const byteLimit = Math.min(maxFileBytes, remainingBytes);
      const loaded = readInstructionFile(absolutePath, byteLimit);
      if (loaded) {
        const relativePath = normalizeRelativePath(path.relative(root, absolutePath));
        const scopePath = normalizeRelativePath(path.dirname(path.relative(root, absolutePath)));
        files.push({
          path: relativePath,
          scope: scopePath === "." ? "workspace root" : `${scopePath}/**`,
          content: loaded.content,
          truncated: loaded.truncated,
        });
        totalBytes += loaded.bytes;
        truncated ||= loaded.truncated;
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
      visit(path.join(directory, entry.name));
      if (files.length >= maxFiles || totalBytes >= maxTotalBytes) {
        truncated = true;
        break;
      }
    }
  };

  visit(root);

  const sections = files.map((file) => [
    `### ${file.path} (scope: ${file.scope})`,
    file.content,
    file.truncated ? "[File truncated by AI Free]" : "",
  ].filter(Boolean).join("\n"));

  return {
    files,
    truncated,
    context: sections.join("\n\n"),
  };
}

function readInstructionFile(filePath, maxBytes) {
  if (maxBytes <= 0) return null;
  try {
    const buffer = fs.readFileSync(filePath);
    const slice = buffer.subarray(0, maxBytes);
    return {
      content: slice.toString("utf8").trim(),
      bytes: slice.length,
      truncated: buffer.length > slice.length,
    };
  } catch {
    return null;
  }
}

function isDirectory(directory) {
  try {
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

function normalizeRelativePath(value) {
  return String(value || ".").split(path.sep).join("/");
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
