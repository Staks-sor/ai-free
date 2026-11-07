import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { buildPromptFromChatBody } from "../api/openai-handler.mjs";

// Regression: reasoning-модели Qwen (qwen3-max и др.) видят [TOOL INSTRUCTIONS]
// в промпте и пытаются ВЫЗВАТЬ эти тулы нативно во время thinking-фазы
// («Tool execute_code does not exists» каскад в веб-морде, 2026-08-21).
// Инструкции должны (1) явно запрещать нативные/внутренние вызовы,
// (2) появляться ТОЛЬКО когда клиент реально передал tools.

const TOOLS = [{
  type: "function",
  function: { name: "web_search", description: "search", parameters: { type: "object", properties: {} } },
}];

describe("buildPromptFromChatBody tool instructions", () => {
  it("forbids native/internal tool calls during thinking", () => {
    const prompt = buildPromptFromChatBody({
      messages: [{ role: "user", content: "hi" }],
      tools: TOOLS,
    }, "qwen3-max", { provider: "qwen", model: "expert" });

    assert.match(prompt, /TOOL INSTRUCTIONS/);
    // Явный запрет нативных вызовов и вызовов из thinking.
    assert.match(prompt, /NO native\/internal tool execution/);
    assert.match(prompt, /NEVER attempt tool calls during your thinking\/reasoning phase/);
    assert.match(prompt, /execute_code, write_file, terminal, tool_search, web_search/);
  });

  it("applies the thinking-phase ban to every model, not only reasoner-named ones", () => {
    // qwen3-max не матчится /reason|r1|qwq|expert/ — но каскад ловили именно на нём.
    const prompt = buildPromptFromChatBody({
      messages: [{ role: "user", content: "hi" }],
      tools: TOOLS,
    }, "qwen3-max", { provider: "qwen", model: "standard" });

    assert.match(prompt, /NEVER attempt tool calls during your thinking\/reasoning phase/);
  });

  it("does not invent tools when the client sent none", () => {
    const prompt = buildPromptFromChatBody({
      messages: [{ role: "user", content: "hi" }],
    }, "qwen3-max", { provider: "qwen", model: "standard" });

    assert.doesNotMatch(prompt, /TOOL INSTRUCTIONS/);
    assert.doesNotMatch(prompt, /tool_calls/);
  });
});
