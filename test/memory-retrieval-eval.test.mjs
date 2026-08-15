import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("memory retrieval quality evaluation", () => {
  let tempDir;
  const workspace = "/tmp/retrieval-eval";

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-retrieval-eval-"));
    process.env.AI_FREE_MEMORY_DIR = tempDir;
    const { resetMemoryBackendForTests, warmMemoryBackend } = await import("../src/memory/db.mjs");
    resetMemoryBackendForTests();
    await warmMemoryBackend();
  });

  after(async () => {
    delete process.env.AI_FREE_MEMORY_DIR;
    const { resetMemoryBackendForTests } = await import("../src/memory/db.mjs");
    const { resetGraphBackendForTests } = await import("../src/memory/graph/store.mjs");
    resetMemoryBackendForTests();
    resetGraphBackendForTests();
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("does not save empty or duplicate experiences", async () => {
    const { saveExperience } = await import("../src/memory/save-experience.mjs");
    const empty = saveExperience({
      task: "просто вопрос",
      workspaceRoot: workspace,
      experience: { files: [], errors: [], summary: { steps: 0, insight: "Execution completed successfully" } },
    });
    assert.deepEqual(empty, []);

    const experience = {
      timestamp: 1_800_000_000_000,
      intent: "fix",
      files: ["src/auth/login.mjs"],
      errors: [],
      problem: "Сессия завершается слишком рано",
      rootCause: "JWT expiry был равен одной минуте",
      verifiedFix: "JWT expiry увеличен до часа",
      verification: "Тест входа прошёл",
      summary: { steps: 3 },
    };
    const first = saveExperience({ task: "Исправить   LOGIN", workspaceRoot: workspace, experience });
    const second = saveExperience({ task: "исправить login", workspaceRoot: workspace, experience });
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(first[0].id, second[0].id);
    assert.equal(second[0].meta.structured.rootCause, "JWT expiry был равен одной минуте");
  });

  it("returns expected useful result and rejects unrelated vector noise", async () => {
    const { addMemory, searchMemory } = await import("../src/memory/store.mjs");
    addMemory({
      type: "fix",
      content: "Problem: ошибка авторизации JWT\nRoot cause: истёк токен\nVerified fix: обновление токена при входе\nFiles: src/auth/login.mjs",
      tags: ["fix", "auth"], workspace,
      meta: { important: true, taskNormalized: "ошибка авторизации jwt" },
    });
    addMemory({
      type: "fix",
      content: "Изменён цвет кнопки и размер боковой панели интерфейса",
      tags: ["fix", "ui"], workspace,
      meta: { important: true, taskNormalized: "стили интерфейса" },
    });
    addMemory({
      type: "note",
      content: "Рецепт яблочного пирога с корицей и сахаром",
      tags: ["note"], workspace,
      meta: { important: true, taskNormalized: "рецепт пирога" },
    });

    const hits = searchMemory("ошибка авторизации JWT токен", workspace);
    assert.ok(hits.some((item) => item.content.includes("src/auth/login.mjs")), "ожидалась полезная запись об авторизации");
    assert.equal(hits.some((item) => /пирог|корица/i.test(item.content)), false, "рецепт не должен попадать в технический retrieval");
  });

  it("passes no more than six unique records to the model", async () => {
    const { addMemory } = await import("../src/memory/store.mjs");
    const { buildMemoryContextResult } = await import("../src/memory/context-builder.mjs");
    for (let i = 0; i < 9; i += 1) {
      addMemory({
        type: "fix",
        content: `Исправление timeout сервера номер ${i}`,
        tags: ["fix", "server"], workspace,
        meta: { important: true, taskNormalized: `timeout сервера ${i}` },
      });
    }
    const result = buildMemoryContextResult("timeout сервера", workspace);
    const recordLines = result.context.split("\n").filter((line) => line.startsWith("- ["));
    assert.ok(recordLines.length <= 6);
    assert.equal(new Set(recordLines).size, recordLines.length);
  });
});
