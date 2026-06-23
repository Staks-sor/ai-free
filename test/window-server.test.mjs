import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { shouldAutoRunBrowserTask } from "../src/window-app/browser-snapshot.mjs";
import { shouldAutoRunCodeTask } from "../src/window-app/server.mjs";
import { resolveConversationAgentTask } from "../src/window-app/agent-task.mjs";

describe("shouldAutoRunCodeTask", () => {
  it("routes direct project work to the code agent", () => {
    assert.equal(shouldAutoRunCodeTask("встраивай memory в loop"), true);
    assert.equal(shouldAutoRunCodeTask("исправь интерфейс чата"), true);
    assert.equal(shouldAutoRunCodeTask("add Anthropic API settings"), true);
    assert.equal(shouldAutoRunCodeTask("создай файл notes.txt"), true);
  });

  it("keeps informational prompts in normal chat", () => {
    assert.equal(shouldAutoRunCodeTask("почему он пишет про Linux контейнер?"), false);
    assert.equal(shouldAutoRunCodeTask("объясни что такое JSON"), false);
    assert.equal(shouldAutoRunCodeTask("how does memory work?"), false);
  });

  it("does not treat generic creative requests as local code tasks", () => {
    assert.equal(shouldAutoRunCodeTask("сделай картинку города"), false);
    assert.equal(shouldAutoRunCodeTask("create a poem"), false);
  });

  it("routes browser click requests to the code agent", () => {
    assert.equal(shouldAutoRunBrowserTask("нажми Принять все в браузере"), true);
    assert.equal(shouldAutoRunBrowserTask("click Accept all on the cookie dialog"), true);
    assert.equal(shouldAutoRunBrowserTask("открой google.com"), true);
    assert.equal(shouldAutoRunBrowserTask("найди образовательные учреждения"), true);
    assert.equal(shouldAutoRunBrowserTask("загугли курс доллара"), true);
    assert.equal(shouldAutoRunBrowserTask("объясни что такое cookies"), false);
  });
});

describe("ChatGPT agent modes", () => {
  it("routes a ChatGPT chat through the code agent when Coder is enabled", () => {
    const input = resolveConversationAgentTask("исправь ошибку в проекте", {
      provider: "chatgpt",
      coderMode: true,
      hardwareMode: false,
    });
    assert.equal(input.run, true);
    assert.equal(input.task, "исправь ошибку в проекте");
  });

  it("routes ESP mode through the hardware code agent", () => {
    const input = resolveConversationAgentTask("прошивка для ESP32", {
      provider: "chatgpt",
      coderMode: true,
      hardwareMode: true,
    });
    assert.equal(input.run, true);
    assert.equal(input.browserOnly, false);
    assert.equal(input.task, "прошивка для ESP32");
  });
});
