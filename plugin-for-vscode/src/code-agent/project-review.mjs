import fs from "node:fs";
import path from "node:path";

import { executeWorkspaceTool } from "./executor.mjs";

const SOURCE_DIRS = ["src", "app", "lib", "api", "packages"];
const TEST_DIRS = ["test", "tests", "__tests__"];
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|cs)$/i;

function filesUnder(root, dir, depth = 0) {
  if (depth > 3 || !fs.existsSync(path.join(root, dir))) return [];
  const entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  return entries.flatMap((entry) => {
    if (entry.name.startsWith(".") || ["node_modules", "dist", "build"].includes(entry.name)) return [];
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(root, relative, depth + 1);
    return entry.isFile() ? [relative] : [];
  });
}

function preferredFile(files) {
  return files.sort((a, b) => {
    const score = (file) => (/(?:^|\/)(?:index|main|app|server|run)\.[^/]+$/i.test(file) ? 10 : 0)
      - file.split(path.sep).length;
    return score(b) - score(a) || a.localeCompare(b);
  })[0];
}

export async function collectProjectReviewEvidence(workspaceRoot) {
  const rootFiles = fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile()).map((entry) => entry.name);
  const documentation = ["README.md", "README.rst", "README.txt", "AGENTS.md"]
    .find((name) => rootFiles.includes(name));
  const manifest = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle.kts"]
    .find((name) => rootFiles.includes(name));
  const source = preferredFile(SOURCE_DIRS.flatMap((dir) => filesUnder(workspaceRoot, dir))
    .filter((file) => SOURCE_EXT.test(file) && !/\.(?:test|spec)\./i.test(file)));
  const test = preferredFile(TEST_DIRS.flatMap((dir) => filesUnder(workspaceRoot, dir))
    .filter((file) => SOURCE_EXT.test(file)));
  const files = [documentation, manifest, source, test].filter(Boolean);
  const results = [];
  for (const file of files) {
    const call = { tool: "read_file", path: file, maxBytes: 3_000 };
    const result = await executeWorkspaceTool(workspaceRoot, call);
    results.push({ call, result });
  }
  const prompt = [
    "Verified local workspace evidence follows. Use it to answer the user's project review with concrete file references. Separate observed facts from suggestions. Do not claim files are Git-tracked based only on a directory listing. Do not request more tools unless a specific gap remains. Call finish with a detailed answer of at least 500 characters.",
    ...results.map(({ result }) => `=== ${result.path}${result.truncated ? " (first 3000 bytes)" : ""} ===\n${result.content}`),
  ].join("\n\n");
  return { files, results, prompt };
}
