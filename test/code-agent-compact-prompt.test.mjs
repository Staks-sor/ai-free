import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runCodeTask } from "../src/code-agent/run.mjs";

describe("code agent compact prompt", () => {
  it("sends only the current task as JSON when the chat already has agent instructions", async () => {
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
        memoryContext: "large memory that must not be resent",
        projectInstructionsContext: "large project instructions that must not be resent",
      });

      assert.equal(prompts.length, 1);
      assert.deepEqual(JSON.parse(prompts[0]), {
        type: "task",
        task: "поработаем?",
      });
      assert.doesNotMatch(prompts[0], /coding agent|large memory|project instructions/i);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
