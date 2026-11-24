import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { buildAgentTaskOptions } from "../src/window-app/agent-task.mjs";
import { createCompactTaskPrompt } from "../src/code-agent/compact-prompt.mjs";
import { buildGoogleAIAgentPrompt } from "../src/providers/google-ai/agent-adapter.mjs";

describe("code prompt lifecycle", () => {
  it("uses the full setup once, then compact JSON tasks for persistent chat providers", () => {
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

    const payload = JSON.parse(createCompactTaskPrompt("  исправь чат  "));
    assert.match(payload.toolGuidance, /read_image.*16 MB/i);
    delete payload.toolGuidance;
    assert.deepEqual(payload, {
      type: "task", task: "исправь чат",
      planGuidance: "For multi-step workspace tasks, use update_plan with 1–12 explicit steps; keep at most one in_progress and complete all steps before finishing. Skip simple one-step and conversational tasks.",
    });
  });

  it("always keeps Google AI Coder prompts compact enough for the web composer", () => {
    for (const codeParentMessageId of [null, "google-step-1"]) {
      const options = buildAgentTaskOptions(
        { provider: "googleai", codeParentMessageId },
        {},
        { hardwareMode: false, systemPrompt: "", agentInput: {} },
      );
      assert.equal(options.compactInitialPrompt, true);
      assert.equal(options.compactContextMaxChars, 600);
      assert.equal(options.compactContinuationMemoryChars, 150);
      assert.equal(options.compactContinuationToolResultChars, 600);

      const compactTask = createCompactTaskPrompt("проверь проект", {
        memoryContext: "m".repeat(5000),
        projectInstructionsContext: "i".repeat(5000),
        maxContextChars: options.compactContextMaxChars,
      });
      assert.ok(
        buildGoogleAIAgentPrompt(compactTask).length < 2200,
        "Google Coder prompt must stay below the reliable web-composer size",
      );
    }
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
