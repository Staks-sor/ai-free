import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("memory vault + search", () => {
  let tempDir;
  let memory;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-memory-"));
    process.env.AI_FREE_MEMORY_DIR = tempDir;
    memory = await import("../src/memory/store.mjs");
    await memory.warmMemoryBackend();
  });

  after(() => {
    delete process.env.AI_FREE_MEMORY_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes markdown vault files on addMemory", async () => {
    const { MEMORY_VAULT } = await import("../src/memory/paths.mjs");
    const item = memory.addMemory({
      type: "fix",
      content: "Fixed login bug in auth module",
      tags: ["fix", "agent"],
      workspace: "/tmp/project",
      meta: { important: true },
    });

    assert.ok(item);
    assert.ok(fs.existsSync(path.join(MEMORY_VAULT, `${item.id}.md`)));
    assert.equal(memory.getMemoryById(item.id)?.content, item.content);
  });

  it("finds memories via FTS or keyword search", () => {
    memory.addMemory({
      type: "error",
      content: "ENOENT when reading missing config.json",
      tags: ["error"],
      workspace: "/tmp/project",
      meta: { important: true },
    });
    memory.addMemory({
      type: "fix",
      content: "Added default config loader",
      tags: ["fix"],
      workspace: "/tmp/project",
      meta: { important: true },
    });

    const backend = memory.getMemoryBackend();
    assert.ok(["sqlite", "json"].includes(backend));

    const hits = memory.searchMemory("config", "/tmp/project");
    assert.ok(hits.length >= 1);
    assert.ok(hits.some((item) => /config/i.test(item.content)));
  });

  it("deletes memory from db and markdown vault", async () => {
    const { MEMORY_VAULT } = await import("../src/memory/paths.mjs");
    const item = memory.addMemory({
      type: "note",
      content: "temporary note about refactor",
      tags: ["agent"],
      meta: { important: true },
    });
    assert.ok(item);
    assert.ok(memory.deleteMemory(item.id));
    assert.equal(memory.getMemoryById(item.id), null);
    assert.equal(fs.existsSync(path.join(MEMORY_VAULT, `${item.id}.md`)), false);
  });
});

describe("memory markdown", () => {
  it("roundtrips frontmatter", async () => {
    const { serializeFrontmatter, parseFrontmatter } = await import("../src/memory/markdown.mjs");
    const meta = serializeFrontmatter({
      id: "abc",
      type: "fix",
      tags: ["fix", "agent"],
      workspace: "/tmp",
    });
    const parsed = parseFrontmatter(`---\n${meta}---\n\nHello memory\n`);
    assert.equal(parsed.meta.id, "abc");
    assert.equal(parsed.meta.type, "fix");
    assert.deepEqual(parsed.meta.tags, ["fix", "agent"]);
    assert.equal(parsed.content, "Hello memory");
  });
});
