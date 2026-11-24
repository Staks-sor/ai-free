import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeWorkspaceTool } from "../src/code-agent/executor.mjs";

test("workspace file tools contain resolved symlink destinations", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-symlink-"));
  const workspace = path.join(base, "project");
  const outside = path.join(base, "outside");
  fs.mkdirSync(workspace);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside secret");
  fs.symlinkSync(outside, path.join(workspace, "external"), "dir");

  try {
    await assert.rejects(executeWorkspaceTool(workspace, { tool: "read_file", path: "external/secret.txt" }));
    await assert.rejects(executeWorkspaceTool(workspace, { tool: "write_file", path: "external/new.txt", content: "escape" }));
    await assert.rejects(executeWorkspaceTool(workspace, { tool: "mkdir", path: "external/new-dir" }));
    assert.equal(fs.existsSync(path.join(outside, "new.txt")), false);
    assert.equal(fs.existsSync(path.join(outside, "new-dir")), false);

    fs.mkdirSync(path.join(workspace, "inside"));
    fs.symlinkSync(path.join(workspace, "inside"), path.join(workspace, "internal"), "dir");
    await executeWorkspaceTool(workspace, { tool: "write_file", path: "internal/new.txt", content: "inside" });
    assert.equal(fs.readFileSync(path.join(workspace, "inside", "new.txt"), "utf8"), "inside");
    await executeWorkspaceTool(workspace, { tool: "mkdir", path: "internal/new-dir" });

    const workspaceLink = path.join(base, "workspace-link");
    fs.symlinkSync(workspace, workspaceLink, "dir");
    await executeWorkspaceTool(workspaceLink, { tool: "write_file", path: "via-root-link.txt", content: "inside" });
    assert.equal(fs.readFileSync(path.join(workspace, "via-root-link.txt"), "utf8"), "inside");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("workspace file tools reject protected real targets reached through symlinks", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-protected-"));
  const workspace = path.join(base, "project");
  fs.mkdirSync(workspace);
  for (const name of [".git", ".env", "node_modules"]) {
    const protectedDir = path.join(workspace, name);
    fs.mkdirSync(protectedDir);
    fs.writeFileSync(path.join(protectedDir, "secret.txt"), "secret");
    fs.symlinkSync(protectedDir, path.join(workspace, `alias-${name.replaceAll(".", "")}`), "dir");
  }
  try {
    for (const name of [".git", ".env", "node_modules"]) {
      const alias = `alias-${name.replaceAll(".", "")}`;
      await assert.rejects(executeWorkspaceTool(workspace, { tool: "read_file", path: `${alias}/secret.txt` }));
      await assert.rejects(executeWorkspaceTool(workspace, { tool: "write_file", path: `${alias}/new.txt`, content: "blocked" }));
      await assert.rejects(executeWorkspaceTool(workspace, { tool: "mkdir", path: `${alias}/new-dir` }));
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
