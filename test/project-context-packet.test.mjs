import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildProjectContextPacket } from "../src/agent-runtime/project-context.mjs";

describe("compact project context packet", () => {
  it("keeps the goal, relevant memory and prior results without reasoning noise", () => {
    const packet = buildProjectContextPacket({
      goal: "Создать 2D-гонку",
      task: "Реализовать физику",
      memoryContext: "- [note] Canvas уже выбран\n- [note] Не использовать внешние изображения",
      outputs: [
        { roleId: "prompt_builder", provider: "deepseek", model: "flash", text: "<think>длинные рассуждения</think>\nRESULT: Нужны дрифт и 3 круга" },
        { roleId: "prompt_builder", provider: "deepseek", model: "flash", text: "RESULT: Нужны дрифт и 3 круга" },
      ],
      maxChars: 1200,
    });

    assert.match(packet, /Цель проекта.*Создать 2D-гонку/is);
    assert.match(packet, /Текущая задача.*Реализовать физику/is);
    assert.match(packet, /Canvas уже выбран/);
    assert.match(packet, /Нужны дрифт и 3 круга/);
    assert.doesNotMatch(packet, /длинные рассуждения/);
    assert.equal((packet.match(/Нужны дрифт и 3 круга/g) || []).length, 1);
    assert.ok(packet.length <= 1200);
  });

  it("redacts credentials and stays inside the requested budget", () => {
    const packet = buildProjectContextPacket({
      task: "Продолжить проект",
      memoryContext: `Authorization: Bearer secret-value\n${"x".repeat(5000)}`,
      maxChars: 500,
    });

    assert.doesNotMatch(packet, /secret-value/);
    assert.match(packet, /REDACTED/);
    assert.ok(packet.length <= 500);
  });
});
