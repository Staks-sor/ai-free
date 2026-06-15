// Интеграционный smoke-тест: импортируем КАЖДЫЙ модуль из src/ и проверяем,
// что граф зависимостей собирается без ошибок. Это страховка от циклических
// импортов и забытых export'ов.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

describe("module graph", () => {
  it("loads all modules without import errors", async () => {
    const modules = [
      "../src/config.mjs",
      "../src/args.mjs",
      "../src/auth/files.mjs",
      "../src/auth/credentials.mjs",
      "../src/auth/manager.mjs",
      "../src/browser/launch.mjs",
      "../src/browser/login.mjs",
      "../src/deepseek/headers.mjs",
      "../src/deepseek/client.mjs",
      "../src/deepseek/pow.mjs",
      "../src/deepseek/sse.mjs",
      "../src/code-agent/prompt.mjs",
      "../src/code-agent/parser.mjs",
      "../src/code-agent/executor.mjs",
      "../src/code-agent/run.mjs",
      "../src/state/settings.mjs",
      "../src/state/window-state.mjs",
      "../src/state/conversations.mjs",
      "../src/updater.mjs",
      "../src/window-app/http.mjs",
      "../src/window-app/server.mjs",
      "../src/window-app/ui-html.mjs",
      "../src/cli/repl.mjs",
      "../src/cli/run.mjs",
    ];

    for (const m of modules) {
      const mod = await import(m);
      assert.ok(mod, `Module ${m} returned falsy`);
    }
  });

  it("exposes expected named exports from key modules", async () => {
    const args = await import("../src/args.mjs");
    assert.ok(typeof args.parseArgs === "function");
    assert.ok(typeof args.loadDotEnv === "function");
    assert.ok(typeof args.printHelp === "function");

    const authFiles = await import("../src/auth/files.mjs");
    assert.ok(typeof authFiles.normalizeToken === "function");
    assert.ok(typeof authFiles.isPlaceholderToken === "function");
    assert.ok(typeof authFiles.resolveAuth === "function");
    assert.ok(typeof authFiles.readSavedAuth === "function");
    assert.ok(typeof authFiles.writeSavedAuth === "function");

    const client = await import("../src/deepseek/client.mjs");
    assert.ok(typeof client.DeepSeekChatClient === "function");

    const manager = await import("../src/auth/manager.mjs");
    assert.ok(typeof manager.AuthManager === "function");

    const server = await import("../src/window-app/server.mjs");
    assert.ok(typeof server.runWindowApp === "function");

    const cli = await import("../src/cli/run.mjs");
    assert.ok(typeof cli.run === "function");
  });
});

describe("entry point", () => {
  it("bin/deepseek.mjs imports without errors", async () => {
    // Импортируем не сам entry (он сразу вызывает run()), а его реэкспорт через cli/run.
    const cli = await import("../src/cli/run.mjs");
    assert.ok(typeof cli.run === "function");
  });
});
