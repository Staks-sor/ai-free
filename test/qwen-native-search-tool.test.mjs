import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { requestSearchEnabled, toolsForModelPrompt } from "../api/openai-handler.mjs";

describe("Qwen native web search detection must not match client function tools", () => {
  it("does NOT enable provider search when web_search arrives as a plain function tool (Hermes Gateway)", () => {
    // Hermes Gateway отправляет web_search как обычный function-тул:
    // { type: "function", function: { name: "web_search", ... } }
    const hermesTools = [
      { type: "function", function: { name: "web_search", description: "Search the web", parameters: { type: "object", properties: { query: { type: "string" } } } } },
      { type: "function", function: { name: "terminal", description: "Run shell command" } },
    ];
    assert.equal(requestSearchEnabled({ tools: hermesTools }), false,
      "A function tool named web_search is executed by the CLIENT via tool_calls, not by Qwen");
  });

  it("still enables provider search for hosted web-search tool types (OpenAI Responses / Anthropic)", () => {
    assert.equal(requestSearchEnabled({ tools: [{ type: "web_search_20250305", name: "web_search" }] }), true);
    assert.equal(requestSearchEnabled({ tools: [{ type: "web_search" }] }), true);
    assert.equal(requestSearchEnabled({ tools: [{ type: "web-search" }] }), true);
  });

  it("still enables provider search for explicit request flags", () => {
    assert.equal(requestSearchEnabled({ search: true }), true);
    assert.equal(requestSearchEnabled({ web_search: true }), true);
    assert.equal(requestSearchEnabled({ web_search_options: {} }), true);
    assert.equal(requestSearchEnabled({ metadata: { search: true } }), true);
  });

  it("keeps the function web_search tool inside the model prompt (client-side execution contract)", () => {
    const hermesTools = [
      { type: "function", function: { name: "web_search" } },
      { type: "function", function: { name: "terminal" } },
    ];
    const filtered = toolsForModelPrompt(hermesTools);
    assert.equal(filtered.length, 2, "Function tools must stay in the prompt so the model can call them back");
    assert.ok(filtered.some((t) => t.function?.name === "web_search"));
  });

  it("still filters out hosted web-search tools from the model prompt", () => {
    const filtered = toolsForModelPrompt([
      { type: "web_search_20250305", name: "web_search" },
      { type: "function", function: { name: "create_reminder" } },
    ]);
    assert.deepEqual(filtered, [{ type: "function", function: { name: "create_reminder" } }]);
  });
});
