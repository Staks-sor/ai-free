import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("memory hybrid search", () => {
  let tempDir;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-hybrid-"));
    process.env.AI_FREE_MEMORY_DIR = tempDir;
    const { resetMemoryBackendForTests, warmMemoryBackend } = await import("../src/memory/db.mjs");
    resetMemoryBackendForTests();
    await warmMemoryBackend();
  });

  after(async () => {
    delete process.env.AI_FREE_MEMORY_DIR;
    const { resetMemoryBackendForTests } = await import("../src/memory/db.mjs");
    resetMemoryBackendForTests();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("merges FTS and vector results", async () => {
    const { addMemory, searchMemory } = await import("../src/memory/store.mjs");
    const ws = "/tmp/hybrid-ws";

    addMemory({
      type: "fix",
      content: "Authentication timeout resolved by increasing JWT expiry",
      tags: ["fix", "auth"],
      workspace: ws,
      meta: { important: true },
    });
    addMemory({
      type: "error",
      content: "Database connection pool exhausted under load",
      tags: ["error", "db"],
      workspace: ws,
      meta: { important: true },
    });

    const authHits = searchMemory("authentication jwt token", ws);
    assert.ok(authHits.some((item) => /authentication/i.test(item.content)));

    const dbHits = searchMemory("database pool load", ws);
    assert.ok(dbHits.some((item) => /database/i.test(item.content)));
  });

  it("buildMemoryContext uses hybrid + graph pipeline", async () => {
    const { saveExperience } = await import("../src/memory/save-experience.mjs");
    const { buildMemoryContextResult } = await import("../src/memory/context-builder.mjs");
    const ws = "/tmp/hybrid-ctx";

    saveExperience({
      task: "fix login authentication",
      workspace: ws,
      experience: {
        intent: "fix",
        files: ["src/auth/login.mjs"],
        errors: [],
        summary: { steps: 2, insight: "Extended session timeout" },
      },
    });

    const ctx = buildMemoryContextResult("login session timeout", ws);
    assert.ok(ctx.usedCount >= 1);
    assert.match(ctx.context, /login|authentication|session/i);
  });
});
