import { it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { collectProjectReviewEvidence } from "../src/code-agent/project-review.mjs";
import { runCodeTask } from "../src/code-agent/run.mjs";

it("preloads representative local files for a DeepSeek project review", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "synvox-review-"));
  try {
    fs.mkdirSync(path.join(root, "src"));
    fs.mkdirSync(path.join(root, "test"));
    fs.writeFileSync(path.join(root, "README.md"), "Real project purpose: desktop assistant.");
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"project-test"}');
    fs.writeFileSync(path.join(root, "src", "main.mjs"), "export const actualSource = true;");
    fs.writeFileSync(path.join(root, "test", "main.test.mjs"), "assert.equal(actualSource, true);");
    fs.writeFileSync(path.join(root, ".env"), "SECRET_SENTINEL");

    const evidence = await collectProjectReviewEvidence(root);
    assert.deepEqual(evidence.files, ["README.md", "package.json", "src/main.mjs", "test/main.test.mjs"]);
    assert.match(evidence.prompt, /Real project purpose/);
    assert.match(evidence.prompt, /actualSource/);
    assert.match(evidence.prompt, /Do not claim files are Git-tracked/i);
    assert.doesNotMatch(evidence.prompt, /SECRET_SENTINEL/);

    let calls = 0;
    const fakeClient = {
      async complete(request) {
        calls += 1;
        assert.match(request.prompt, /Real project purpose/);
        assert.match(request.prompt, /src\/main\.mjs/);
        return { text: '{"tool":"finish","message":"' + "Review. ".repeat(85) + '"}', lastAssistantMessageId: 1 };
      },
    };
    const result = await runCodeTask(fakeClient, { sessionId: "test" }, root,
      "как думаешь что можно улучшить в проекте?", null,
      { preloadProjectReview: true, memoryEnabled: false });
    assert.equal(calls, 1);
    assert.equal(result.toolLogs.length, 4);
    assert.match(result.message, /Review/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
