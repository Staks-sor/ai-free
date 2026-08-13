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
      assert.deepEqual(JSON.parse(prompts[0]), {
        type: "task",
        task: "поработаем?",
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
});
