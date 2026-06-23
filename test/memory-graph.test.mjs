import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("memory graph", () => {
  let tempDir;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-graph-"));
    process.env.AI_FREE_MEMORY_DIR = tempDir;
    const { resetMemoryBackendForTests, warmMemoryBackend } = await import("../src/memory/db.mjs");
    const { resetGraphBackendForTests, warmGraphBackend } = await import("../src/memory/graph/store.mjs");
    resetMemoryBackendForTests();
    resetGraphBackendForTests();
    await warmMemoryBackend();
    await warmGraphBackend();
  });

  after(async () => {
    delete process.env.AI_FREE_MEMORY_DIR;
    const { resetMemoryBackendForTests } = await import("../src/memory/db.mjs");
    const { resetGraphBackendForTests } = await import("../src/memory/graph/store.mjs");
    resetMemoryBackendForTests();
    resetGraphBackendForTests();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("links experience items and expands context via graph", async () => {
    const { saveExperience } = await import("../src/memory/save-experience.mjs");
    const { buildMemoryContextResult } = await import("../src/memory/context-builder.mjs");
    const { getNeighbors } = await import("../src/memory/graph/store.mjs");

    const workspace = "/tmp/demo-project";

    const saved = saveExperience({
      task: "fix auth login timeout",
      workspace,
      experience: {
        intent: "bugfix",
        files: ["src/auth/login.mjs"],
        errors: [{ tool: "run_command", message: "timeout after 30s" }],
        summary: { steps: 3, insight: "Increased timeout and added retry" },
      },
    });
    assert.ok(saved.length >= 1);

    const { nodes } = getNeighbors(`mem:${saved[0].id}`, { workspace, limit: 10 });
    assert.ok(nodes.some((node) => node.kind === "file"));
    assert.ok(nodes.some((node) => node.kind === "task"));

    const ctx = buildMemoryContextResult("auth login timeout", workspace);
    assert.ok(ctx.usedCount >= 1);
  });

  it("creates file and fix edges on successful run", async () => {
    const { saveExperience } = await import("../src/memory/save-experience.mjs");
    const { getNeighbors } = await import("../src/memory/graph/store.mjs");

    const workspace = "/tmp/graph-fix";
    const saved = saveExperience({
      task: "add health check endpoint",
      workspace,
      experience: {
        intent: "feature",
        files: ["src/server.mjs"],
        errors: [],
        summary: { steps: 2, insight: "Added /health route" },
      },
    });

    assert.ok(saved.length >= 1);
    const { nodes, edges } = getNeighbors(`mem:${saved[0].id}`, { workspace, limit: 20 });
    assert.ok(nodes.some((node) => node.kind === "file" && node.label.includes("server.mjs")));
    assert.ok(edges.some((edge) => edge.relation === "touches" || edge.relation === "fixed_in"));
  });
});
