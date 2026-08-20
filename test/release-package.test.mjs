import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assertTestExclusions(contents, label) {
  for (const pattern of ["test/", "**/test/**", "**/tests/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*", "coverage/"]) {
    assert.ok(
      contents.split(/\r?\n/).includes(pattern),
      `${label} must exclude ${pattern}`,
    );
  }
}

test("client release packages explicitly exclude internal tests", () => {
  assertTestExclusions(read(".npmignore"), ".npmignore");
  assertTestExclusions(read("plugin-for-vscode/.vscodeignore"), "plugin-for-vscode/.vscodeignore");
});

test("README presents the current desktop agent screenshot", () => {
  const asset = "docs/assets/ai-free-agent-0.4.13.png";
  assert.ok(fs.existsSync(path.join(root, asset)), `${asset} must exist`);
  assert.match(read("README.md"), new RegExp(asset.replaceAll(".", "\\.")));
});

test("plugin packages keep shared core inside their distributable runtime", () => {
  const rootPackage = JSON.parse(read("package.json"));
  assert.equal(rootPackage.workspaces.includes("plugin-for-vscode"), false);
  assert.equal(rootPackage.scripts["precheck:ci"], "node plugin-for-vscode/build.mjs");

  const vscodeRoot = path.join(root, "plugin-for-vscode");
  const wrapperFiles = [
    "src/code-agent/parser.mjs",
    "src/i18n/index.mjs",
    "src/i18n/languages/en.mjs",
    "src/memory/markdown.mjs",
    "src/memory/search/fts-query.mjs",
    "src/providers/model-catalog.mjs",
  ];

  for (const relativePath of wrapperFiles) {
    const source = read(`plugin-for-vscode/${relativePath}`);
    const importPath = source.match(/from\s+"([^"]+packages\/core[^"]+)"/)?.[1];
    assert.ok(importPath, `${relativePath} must re-export shared core`);
    const resolved = path.resolve(path.dirname(path.join(vscodeRoot, relativePath)), importPath);
    assert.ok(resolved.startsWith(`${vscodeRoot}${path.sep}`), `${relativePath} must not escape the VS Code package`);
  }

  assert.match(read("plugin-for-vscode/build.mjs"), /sharedCoreSource[\s\S]+\.\.\/packages\/core/);
  assert.match(read("plugin-for-vscode/build.mjs"), /fs\.cpSync\(sharedCoreSource, sharedCoreTarget/);
  assert.match(read("plugin-for-jetbrains/build.gradle.kts"), /include\([^\n]*"packages\/core\/\*\*"/);
});
