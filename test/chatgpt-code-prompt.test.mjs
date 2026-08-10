import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { buildAgentTaskOptions } from "../src/window-app/agent-task.mjs";
import { createCompactTaskPrompt } from "../src/code-agent/compact-prompt.mjs";

describe("code prompt lifecycle", () => {
  it("uses the full setup once, then compact JSON tasks for every persistent chat provider", () => {
    for (const provider of ["chatgpt", "qwen", "deepseek"]) {
      const first = buildAgentTaskOptions(
        { provider, codeParentMessageId: null },
        {},
        { hardwareMode: false, systemPrompt: "", agentInput: {} },
      );
      const next = buildAgentTaskOptions(
        { provider, codeParentMessageId: `${provider}-step-1` },
        {},
        { hardwareMode: false, systemPrompt: "", agentInput: {} },
      );

      assert.equal(first.compactInitialPrompt, false, `${provider} must receive setup in a new chain`);
      assert.equal(next.compactInitialPrompt, true, `${provider} must reuse setup from its chain`);
    }

    assert.equal(createCompactTaskPrompt("  исправь чат  "), '{"type":"task","task":"исправь чат"}');
  });

  it("does not compact a provider without an explicitly supported persistent context", () => {
    const options = buildAgentTaskOptions(
      { provider: "unknown-provider", codeParentMessageId: "step-1" },
      {},
      { hardwareMode: false, systemPrompt: "", agentInput: {} },
    );
    assert.equal(options.compactInitialPrompt, false);
  });
});
