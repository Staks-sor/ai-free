import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("memory async queue", () => {
  let tempDir;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-async-"));
    process.env.AI_FREE_MEMORY_DIR = tempDir;
    const { resetMemoryBackendForTests, warmMemoryBackend } = await import("../src/memory/db.mjs");
    const { resetGraphBackendForTests, warmGraphBackend } = await import("../src/memory/graph/store.mjs");
    const { resetMemoryQueueForTests } = await import("../src/memory/async-queue.mjs");
    resetMemoryBackendForTests();
    resetGraphBackendForTests();
    resetMemoryQueueForTests();
    await warmMemoryBackend();
    await warmGraphBackend();
  });

  after(async () => {
    const { flushMemoryQueueForTests, resetMemoryQueueForTests } = await import("../src/memory/async-queue.mjs");
    const { resetMemoryBackendForTests } = await import("../src/memory/db.mjs");
    const { resetGraphBackendForTests } = await import("../src/memory/graph/store.mjs");
    await flushMemoryQueueForTests();
    resetMemoryQueueForTests();
    resetMemoryBackendForTests();
    resetGraphBackendForTests();
    delete process.env.AI_FREE_MEMORY_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns immediately and saves in background", async () => {
    const {
      enqueueCodeExperienceSave,
      flushMemoryQueueForTests,
      getMemoryQueueStats,
    } = await import("../src/memory/async-queue.mjs");
    const { searchMemory } = await import("../src/memory/store.mjs");

    const ws = "/tmp/async-code";
    let callbackCount = 0;

    const pending = enqueueCodeExperienceSave({
      task: "fix async memory queue bug",
      workspaceRoot: ws,
      toolLogs: ["[tool] write_file src/memory/async-queue.mjs ok:true"],
      onComplete: ({ count }) => {
        callbackCount += 1;
        assert.ok(count >= 1);
      },
    });

    assert.equal(pending, true);
    assert.ok(getMemoryQueueStats().pending >= 0);

    await flushMemoryQueueForTests();
    assert.equal(callbackCount, 1);
    assert.equal(getMemoryQueueStats().pending, 0);

    const hits = searchMemory("async memory queue", ws);
    assert.ok(hits.some((item) => /async memory/i.test(item.content)));
  });

  it("coalesces duplicate jobs and caps queue size", async () => {
    const {
      enqueueCodeExperienceSave,
      flushMemoryQueueForTests,
      getMemoryQueueStats,
      resetMemoryQueueForTests,
    } = await import("../src/memory/async-queue.mjs");

    resetMemoryQueueForTests();

    for (let i = 0; i < 30; i += 1) {
      enqueueCodeExperienceSave({
        task: "same task key",
        workspaceRoot: "/tmp/coalesce",
        toolLogs: [`[tool] run_command step-${i}`],
      });
    }

    const stats = getMemoryQueueStats();
    assert.ok(stats.coalesced >= 1 || stats.dropped >= 1);
    assert.ok(stats.pending <= 24);

    await flushMemoryQueueForTests();
  });

  it("filters noisy chat turns", async () => {
    const { shouldSaveChatTurn } = await import("../src/memory/chat-save.mjs");
    assert.equal(shouldSaveChatTurn("hi", "hello"), false);
    assert.equal(shouldSaveChatTurn("fix login bug", "updated auth config"), true);
  });
});
