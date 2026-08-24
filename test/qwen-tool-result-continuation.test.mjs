import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { buildPromptFromChatBody } from "../api/openai-handler.mjs";

// Деградация 2026-08-21: после двух успешных tool calls модель ответила
// голым "Yes" на user-сообщение "retry and continue", вместо продолжения
// задачи. Причина: промпт заканчивается [TOOL RESULT] + общий SYSTEM
// REMINDER про формат — без директивы «задача в процессе, продолжай
// сейчас». Модель читает последний user-месседж как yes/no-вопрос.

const TOOLS = [{
  type: "function",
  function: { name: "execute_code", description: "run python", parameters: { type: "object", properties: {} } },
}];

const MESSAGES = [
  { role: "user", content: "fix the bug in app.py" },
  {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "c1", type: "function", function: { name: "execute_code", arguments: "{\"code\":\"1+1\"}" } }],
  },
  { role: "tool", tool_call_id: "c1", name: "execute_code", content: "2" },
];

describe("buildPromptFromChatBody tool-result continuation", () => {
  it("ends with a continuation directive when the last message is a tool result", () => {
    const prompt = buildPromptFromChatBody({ messages: MESSAGES, tools: TOOLS }, "qwen3-max", { provider: "qwen", model: "standard" });

    // Директива продолжения: задача в процессе, продолжать сейчас.
    assert.match(prompt, /IN PROGRESS|Continue NOW/i);
    // Явный запрет голых подтверждений.
    assert.match(prompt, /"Yes"/);
    // TOOL RESULT присутствует в транскрипте.
    assert.match(prompt, /\[TOOL RESULT FOR execute_code\]/);
  });

  it("keeps the format-only reminder when the last message is not a tool result", () => {
    const prompt = buildPromptFromChatBody({
      messages: [{ role: "user", content: "hi" }],
      tools: TOOLS,
    }, "qwen3-max", { provider: "qwen", model: "standard" });

    assert.match(prompt, /You MUST use the exact JSON array format/);
    assert.doesNotMatch(prompt, /IN PROGRESS/);
  });
});
