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
