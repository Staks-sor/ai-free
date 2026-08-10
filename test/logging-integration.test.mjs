import fs from "node:fs";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

describe("persistent logging integration", () => {
  it("initializes process logging in desktop and packaged VS Code entrypoints", () => {
    const desktop = read("bin/deepseek.mjs");
    const plugin = read("plugin-for-vscode/bin/deepseek.mjs");
    assert.match(desktop, /installProcessErrorLogging/);
    assert.match(desktop, /AI_FREE_VERSION/);
    assert.match(plugin, /installProcessErrorLogging/);
  });

  it("records HTTP lifecycle and privacy-safe chat metadata", () => {
    const source = read("src/window-app/server.mjs");
    assert.match(source, /http\.request\.complete/);
    assert.match(source, /chat\.message\.received/);
    assert.match(source, /promptChars/);
    assert.doesNotMatch(source, /chatLogger\.(?:debug|info|warn|error)\([^\n]+prompt[,}]/);
  });

  it("records background task and code-agent model/tool spans", () => {
    const taskRunner = read("src/window-app/task-runner.mjs");
    const codeAgent = read("src/code-agent/run.mjs");
    assert.match(taskRunner, /background_task\.start/);
    assert.match(taskRunner, /background_task\.success/);
    assert.match(taskRunner, /background_task\.error/);
    assert.match(codeAgent, /withLogSpan/);
    assert.match(codeAgent, /agent\.model_complete/);
    assert.match(codeAgent, /agent\.tool_execute/);
  });

  it("records provider requests, retries, statuses and failures", () => {
    for (const provider of ["deepseek", "qwen", "chatgpt"]) {
      const source = read(`src/providers/${provider}/client.mjs`);
      assert.match(source, new RegExp(`provider\\.${provider}\\.request`), provider);
      assert.match(source, new RegExp(`provider\\.${provider}\\.error`), provider);
    }
  });

  it("keeps the logger and integration points identical in desktop and VS Code", () => {
    const files = [
      "logging/logger.mjs",
      "code-agent/run.mjs",
      "window-app/task-runner.mjs",
      "window-app/server.mjs",
      "providers/deepseek/client.mjs",
      "providers/qwen/client.mjs",
      "providers/chatgpt/client.mjs",
    ];
    for (const file of files) {
      assert.equal(read(`plugin-for-vscode/src/${file}`), read(`src/${file}`), file);
    }
  });
});

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}
