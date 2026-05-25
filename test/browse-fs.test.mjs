import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { isDirectoryEntry, listBrowseDirectories } from "../src/window-app/browse-fs.mjs";

describe("browse-fs", () => {
  it("lists subdirectories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "browse-test-"));
    try {
      fs.mkdirSync(path.join(root, "alpha"));
      fs.mkdirSync(path.join(root, "beta"));
      fs.writeFileSync(path.join(root, "readme.txt"), "x");
      const result = listBrowseDirectories(root);
      assert.deepEqual(result.entries.map((e) => e.name), ["alpha", "beta"]);
      assert.equal(result.totalDirectories, 2);
      assert.equal(result.truncated, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes symlink to directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "browse-symlink-"));
    try {
      const real = path.join(root, "realdir");
      fs.mkdirSync(real);
      fs.symlinkSync(real, path.join(root, "linkdir"), "dir");
      const raw = fs.readdirSync(root, { withFileTypes: true });
      const link = raw.find((e) => e.name === "linkdir");
      assert.ok(link);
      assert.equal(isDirectoryEntry(link, root), true);
      const result = listBrowseDirectories(root);
      assert.ok(result.entries.some((e) => e.name === "linkdir"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("hides dot directories unless showHidden", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "browse-hidden-"));
    try {
      fs.mkdirSync(path.join(root, ".git"));
      fs.mkdirSync(path.join(root, "src"));
      const hidden = listBrowseDirectories(root, { showHidden: false });
      assert.deepEqual(hidden.entries.map((e) => e.name), ["src"]);
      const shown = listBrowseDirectories(root, { showHidden: true });
      assert.equal(shown.entries.length, 2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
