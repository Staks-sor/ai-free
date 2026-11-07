import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toolRefresherBlock } from "../api/openai-handler.mjs";

// 2026-10-02 (TG-инцидент «Hermes не может подгрузить скиллы»): на глубине
// tool-loop 376+ qwen3.8-max отвечает прозой и «признаётся», что инструменты
// не отзываются — при живых tools:34 и успешном стриме. Транспорт ни при чём:
// инструкции тулов лежат в ГОЛОВЕ промпта, за 60–100к символов от хвоста,
// attention на такой глубине размыт. Лечение: на глубоких циклах повторять
// КОМПАКТНЫЙ список тулов + формат в самом ХВОСТЕ промпта — последнее, что
// модель читает перед генерацией.
describe("toolRefresherBlock", () => {
  const tools = [
    { type: "function", function: { name: "skill_view", description: "load skill", parameters: {} } },
    { type: "function", function: { name: "read_file", description: "read", parameters: {} } },
  ];

  it("глубина ниже порога и gap мал → пусто (не раздуваем обычные ходы)", () => {
    assert.equal(toolRefresherBlock({ tools, messageCount: 10 }), "");
    assert.equal(toolRefresherBlock({ tools, messageCount: 40 }), "");
  });

  it("глубина выше порога → блок с именами тулов и форматом tool_calls", () => {
    const block = toolRefresherBlock({ tools, messageCount: 376 });
    assert.match(block, /skill_view/);
    assert.match(block, /read_file/);
    assert.match(block, /tool_calls/);
    assert.match(block, /376/); // модель видит, что разговор длинный
  });

  it("тулов нет → пусто, даже на глубине", () => {
    assert.equal(toolRefresherBlock({ tools: [], messageCount: 500 }), "");
    assert.equal(toolRefresherBlock({ tools: null, messageCount: 500 }), "");
  });

  it("порог из env (0 = выключить depth-триггер)", () => {
    process.env.QWEN_TOOL_REFRESHER_DEPTH = "0";
    try {
      assert.equal(toolRefresherBlock({ tools, messageCount: 500 }), "");
      const block = toolRefresherBlock({ tools, messageCount: 50 });
      assert.equal(block, ""); // depth off, gap не задан → пусто
    } finally {
      delete process.env.QWEN_TOOL_REFRESHER_DEPTH;
    }
  });
});
