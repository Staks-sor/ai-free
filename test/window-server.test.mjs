import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { shouldAutoRunBrowserTask } from "../src/window-app/browser-snapshot.mjs";
import {
  appendEconomyOSVisionContext,
  buildLegacyEconomyResume,
  captureRunningClarification,
  takeRunningClarifications,
  isEconomyResumePrompt,
  shouldAutoRunCodeTask,
} from "../src/window-app/server.mjs";
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

  it("routes only explicit page interaction to the browser agent", () => {
    assert.equal(shouldAutoRunBrowserTask("нажми Принять все в браузере"), true);
    assert.equal(shouldAutoRunBrowserTask("click Accept all on the cookie dialog"), true);
    assert.equal(shouldAutoRunBrowserTask("открой google.com"), true);
    assert.equal(shouldAutoRunBrowserTask("найди образовательные учреждения"), false);
    assert.equal(shouldAutoRunBrowserTask("загугли курс доллара"), false);
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

describe("EconomyOS vision bridge", () => {
  it("uses GLM 5V to describe images for the selected coding model", async () => {
    let request;
    let savedDescription = "";
    const client = {
      async complete(options) {
        request = options;
        return { text: "A settings screen with an API validation error." };
      },
    };

    const prompt = await appendEconomyOSVisionContext(
      client,
      "Fix the problem shown",
      [{ mimeType: "image/png", dataBase64: "aW1hZ2U=" }],
      null,
      (description) => { savedDescription = description; },
    );

    assert.equal(request.model, "z-ai-glm-5v-turbo");
    assert.equal(request.images.length, 1);
    assert.match(prompt, /Fix the problem shown/);
    assert.match(prompt, /settings screen with an API validation error/);
    assert.equal(savedDescription, "A settings screen with an API validation error.");
  });
});

describe("EconomyOS checkpoint resume", () => {
  it("recognizes explicit continuation without routing unrelated chat", () => {
    assert.equal(isEconomyResumePrompt("продолжай"), true);
    assert.equal(isEconomyResumePrompt("продолжай и учти новый файл"), true);
    assert.equal(isEconomyResumePrompt("resume"), true);
    assert.equal(isEconomyResumePrompt("объясни ошибку"), false);
  });

  it("recovers an old failed task from its persisted tool logs", () => {
    const resume = buildLegacyEconomyResume({
      messages: [
        { role: "user", content: "Fix the provider" },
        {
          role: "assistant",
          content: "⚠️ EconomyOS /code error: Rate limit exceeded",
          toolLogs: ["[tool] read_file src/provider.mjs", "[tool] run_shell npm test"],
        },
        { role: "user", content: "продолжай" },
      ],
    });

    assert.equal(resume.legacy, true);
    assert.match(resume.task, /Fix the provider/);
    assert.match(resume.task, /read_file src\/provider\.mjs/);
    assert.equal(resume.toolLogs.length, 2);
  });
});


describe("running clarification capture", () => {
  it("queues the clarification without adding a duplicate user message", () => {
    const conversation = { messages: [{ role: "user", content: "уточнение" }] };
    captureRunningClarification(conversation, "уточнение");
    assert.equal(conversation.messages.length, 1);
    assert.deepEqual(takeRunningClarifications(conversation), ["уточнение"]);
  });

  it("deduplicates an immediately repeated clarification", () => {
    const conversation = { messages: [] };
    captureRunningClarification(conversation, "уточнение");
    captureRunningClarification(conversation, "уточнение");
    assert.deepEqual(takeRunningClarifications(conversation), ["уточнение"]);
  });
});
