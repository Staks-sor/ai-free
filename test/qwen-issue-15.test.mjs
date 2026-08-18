import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { createQwenIncrementalParser } from "../src/providers/qwen/client.mjs";
import { formatCompactTools, parseModelToolCalls } from "../api/tool-calls.mjs";
import { buildPromptFromChatBody } from "../api/openai-handler.mjs";

describe("Issue #15 verification: Qwen stream with thinking and 28 tools", () => {
  it("compacts 28 tools without dropping parameter types or names", () => {
    // Generate 28 verbose tools as sent by OpenClaw / Hermes
    const tools = Array.from({ length: 28 }, (_, i) => ({
      type: "function",
      function: {
        name: `tool_action_${i + 1}`,
        description: `Perform automated maintenance step ${i + 1} with diagnostics and logging`,
        parameters: {
          $schema: "http://json-schema.org/draft-07/schema#",
          $id: `https://schema.example.com/tool_${i + 1}`,
          type: "object",
          properties: {
            target_path: { type: "string", description: "Target file path", $schema: "draft-7" },
            force: { type: "boolean", default: false },
            options: { type: "object", additionalProperties: false, properties: { timeout: { type: "number" } } },
          },
          required: ["target_path"],
          additionalProperties: false,
        },
      },
    }));

    const verboseJson = JSON.stringify(tools, null, 2);
    const compactJson = formatCompactTools(tools);

    // Verify significant size reduction
    assert.ok(compactJson.length < verboseJson.length * 0.7, "Compact format must be much smaller");

    // Verify schema integrity
    const parsed = JSON.parse(compactJson);
    assert.equal(parsed.length, 28);
    assert.equal(parsed[0].function.name, "tool_action_1");
    assert.equal(parsed[0].function.parameters.required[0], "target_path");
    assert.equal(parsed[0].function.parameters.$schema, undefined, "$schema must be stripped");
  });

  it("incremental parser returns true during thinking chunks (preventing false first_content_timeout)", () => {
    let receivedThinking = "";
    let receivedText = "";

    const parser = createQwenIncrementalParser({
      onThinking: (t) => { receivedThinking += t; },
      onText: (t) => { receivedText += t; },
    });

    // Chunk 1: Qwen sends first thinking chunk (phase: "think")
    const chunk1 = 'data: {"choices":[{"delta":{"content":"Thinking about which tool to call...","phase":"think"},"index":0}],"created":1723456789,"id":"qwen-123","model":"qwen3.7-max"}\n\n';
    const chunk1HasContent = parser.push(chunk1);

    // CRITICAL: push() MUST return true so browser-proxy knows content arrived!
    assert.equal(chunk1HasContent, true, "Chunk with thinking content MUST register as meaningful content");
    assert.equal(receivedThinking, "Thinking about which tool to call...");
    assert.equal(receivedText, "");

    // Chunk 2: Qwen sends second thinking chunk
    const chunk2 = 'data: {"choices":[{"delta":{"content":" Deciding on tool_action_1.","phase":"think"},"index":0}],"created":1723456789,"id":"qwen-123","model":"qwen3.7-max"}\n\n';
    const chunk2HasContent = parser.push(chunk2);
    assert.equal(chunk2HasContent, true, "Subsequent thinking chunks MUST also register as meaningful content");

    // Chunk 3: Qwen sends tool call in text phase
    const toolCallBlock = '```tool_calls\n[{"name":"tool_action_1","arguments":{"target_path":"src/index.js"}}]\n```';
    const chunk3 = `data: {"choices":[{"delta":{"content":${JSON.stringify(toolCallBlock)},"phase":"answer"},"index":0}],"created":1723456789,"id":"qwen-123","model":"qwen3.7-max"}\n\n`;
    const chunk3HasContent = parser.push(chunk3);
    assert.equal(chunk3HasContent, true);

    // Chunk 4: Stream completion [DONE]
    parser.push("data: [DONE]\n\n");

    const result = parser.finish();
    assert.equal(result.error, null);
    assert.match(result.thinkingText, /Thinking about which tool to call/);
    assert.match(result.text, /tool_action_1/);

    // Verify tool call parsing from the resulting text
    const parsedCalls = parseModelToolCalls(result.text);
    assert.equal(parsedCalls.calls.length, 1);
    assert.equal(parsedCalls.calls[0].name, "tool_action_1");
    assert.deepEqual(JSON.parse(parsedCalls.calls[0].arguments), { target_path: "src/index.js" });
  });
});
