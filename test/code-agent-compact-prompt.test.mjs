import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runCodeTask } from "../src/code-agent/run.mjs";

describe("code agent compact prompt", () => {
  it("sends the current task with refreshed compact memory and project instructions", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "code-compact-"));
    const prompts = [];
    const client = {
      async complete(request) {
        prompts.push(request.prompt);
        return {
          text: '{"tool":"finish","message":"готово"}',
          lastAssistantMessageId: "m1",
        };
      },
    };

    try {
      await runCodeTask(client, { sessionId: "existing-chat" }, workspace, "поработаем?", null, {
        compactInitialPrompt: true,
        memoryContext: "relevant compressed project memory",
        projectInstructionsContext: "current scoped project instructions",
      });

      assert.equal(prompts.length, 1);
      const payload = JSON.parse(prompts[0]);
      assert.match(payload.toolGuidance, /read_image.*16 MB/i);
      delete payload.toolGuidance;
      assert.deepEqual(payload, {
        type: "task",
        task: "поработаем?",
        planGuidance: "For multi-step workspace tasks, use update_plan with 1–12 explicit steps; keep at most one in_progress and complete all steps before finishing. Skip simple one-step and conversational tasks.",
        context: {
          memory: "relevant compressed project memory",
          projectInstructions: "current scoped project instructions",
        },
      });
      assert.doesNotMatch(prompts[0], /coding agent/i);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it("bounds compact context without dropping memory or project instructions", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "code-compact-bounded-"));
    const prompts = [];
    const client = {
      async complete(request) {
        prompts.push(request.prompt);
        return {
          text: '{"tool":"finish","message":"готово"}',
          lastAssistantMessageId: "m1",
        };
      },
    };

    try {
      await runCodeTask(client, {}, workspace, "создай папку", null, {
        compactInitialPrompt: true,
        compactContextMaxChars: 600,
        memoryContext: `memory:${"m".repeat(8000)}`,
        projectInstructionsContext: `instructions:${"i".repeat(8000)}`,
      });

      const payload = JSON.parse(prompts[0]);
      assert.equal(payload.task, "создай папку");
      assert.match(payload.context.memory, /^memory:/);
      assert.match(payload.context.projectInstructions, /^instructions:/);
      assert.match(payload.context.memory, /\[truncated\]$/);
      assert.match(payload.context.projectInstructions, /\[truncated\]$/);
      assert.ok(prompts[0].length < 1200, `compact prompt is ${prompts[0].length} chars`);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
