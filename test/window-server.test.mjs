import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { shouldAutoRunBrowserTask } from "../src/window-app/browser-snapshot.mjs";
import {
  captureRunningClarification,
  takeRunningClarifications,
  isChatGPTLoginRecoveryRequired,
  shouldAutoRunCodeTask,
} from "../src/window-app/server.mjs";
import { getDeepSeekResumeCheckpoint, migrateLegacyCodeSession, resolveConversationAgentTask } from "../src/window-app/agent-task.mjs";

describe("shouldAutoRunCodeTask", () => {
  it("can resume a saved DeepSeek task after an app restart", () => {
    const checkpoint = { task: "изучи проект", prompt: "next tool", toolLogs: ["read README"] };
    assert.equal(getDeepSeekResumeCheckpoint({ deepseekCheckpoint: checkpoint, deepseekPaused: false }, "продолжи"), checkpoint);
    assert.equal(getDeepSeekResumeCheckpoint({ deepseekCheckpoint: checkpoint }, "новая задача"), null);
  });
  it("routes direct project work to the code agent", () => {
    assert.equal(shouldAutoRunCodeTask("встраивай memory в loop"), true);
    assert.equal(shouldAutoRunCodeTask("исправь интерфейс чата"), true);
    assert.equal(shouldAutoRunCodeTask("add Anthropic API settings"), true);
    assert.equal(shouldAutoRunCodeTask("создай файл notes.txt"), true);
    assert.equal(shouldAutoRunCodeTask("про текущий проект изучи его кратко и дай рекомендации"), true);
    assert.equal(shouldAutoRunCodeTask("в смысле ты не видишь папку где он находится?"), true);
    assert.equal(shouldAutoRunCodeTask("что можешь сказать о текущем проекте?"), true);
    assert.equal(shouldAutoRunCodeTask("что бы такого сюда добавить можно было бы что бы улучшить работы нашей программы"), true);
    assert.equal(shouldAutoRunCodeTask("Какую задачу решает наша программа и что стоит улучшить?"), true);
    assert.equal(shouldAutoRunCodeTask("проанализируй проект"), true);
    assert.equal(shouldAutoRunCodeTask("как думаешь что можно улучшить в проекте?"), true);
    assert.equal(resolveConversationAgentTask("как думаешь что можно улучшить в проекте?", {
      provider: "deepseek", workspace: "/tmp/project", coderMode: true,
    }, { autoCodeMode: shouldAutoRunCodeTask("как думаешь что можно улучшить в проекте?") }).run, true);
    assert.equal(shouldAutoRunCodeTask("оцени кодовую базу"), true);
    assert.equal(resolveConversationAgentTask("проанализируй проект", { provider: "glm", workspace: "/tmp/project" }, { autoCodeMode: shouldAutoRunCodeTask("проанализируй проект") }).run, true);
  });

  it("keeps informational prompts in normal chat", () => {
    assert.equal(shouldAutoRunCodeTask("почему он пишет про Linux контейнер?"), false);
    assert.equal(shouldAutoRunCodeTask("объясни что такое JSON"), false);
    assert.equal(shouldAutoRunCodeTask("что такое проект?"), false);
    assert.equal(shouldAutoRunCodeTask("что такое анализ проекта?"), false);
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
  it("opens the Qwen account login when a managed session needs reconnecting", () => {
    for (const file of ["src/window-app/server.mjs", "plugin-for-vscode/src/window-app/server.mjs"]) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /onLoginRequired: async accountId =>[\s\S]{0,900}qwenAccounts\.action\(\{ action: ['"]login['"]/);
    }
  });
  it("keeps chat and Coder backend sessions separate in desktop and VS Code", () => {
    for (const file of ["src/window-app/server.mjs", "plugin-for-vscode/src/window-app/server.mjs"]) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /migrateLegacyCodeSession\(conversation\)/, file);
      assert.match(source, /qwenSessionField = qwenCodeTurn \? "codeSessionId" : "sessionId"/, file);
      assert.match(source, /qwenAccountField = qwenCodeTurn \? "qwenCodeAccountId" : "qwenAccountId"/, file);
      assert.match(source, /createChatGPTAgentAdapter[\s\S]{0,170}conversationId: getCodeSessionId\(conversation\)/, file);
      assert.match(source, /\["googleai", "glm"\][\s\S]{0,2500}conversationId: getCodeSessionId\(conversation\)/, file);
      assert.match(source, /if \(!getCodeSessionId\(conversation\)\)\s*\{\s*setCodeSessionId\(conversation, await client\.createSession\(\)\)/, file);
    }
  });
  it("keeps every Coder message in the agent for every provider", () => {
    for (const provider of ["deepseek", "qwen", "chatgpt", "codex", "googleai", "glm", "antigravity"]) {
      const conversation = { provider, coderMode: true, hardwareMode: false };
      assert.equal(resolveConversationAgentTask("поговорим про новости", conversation).run, true, provider);
      for (const prompt of ["ты внутри проекта посмотри", "привет", "а здесь почему так?", "посмотри что там"]) {
        const input = resolveConversationAgentTask(prompt, conversation);
        assert.equal(input.run, true, `${provider}: ${prompt}`);
        assert.equal(input.task, prompt);
        assert.equal(input.browserOnly, false);
      }
      assert.equal(resolveConversationAgentTask("поговорим про новости", { ...conversation, coderMode: false }).run, false, provider);
      assert.equal(resolveConversationAgentTask("изучи текущий проект", conversation, { autoCodeMode: true }).run, true, provider);
      assert.equal(resolveConversationAgentTask("/code изучи текущий проект", conversation).run, true, provider);
    }
  });

  it("migrates legacy mixed browser sessions without deleting the code thread", () => {
    for (const provider of ["chatgpt", "qwen", "googleai", "deepseek"]) {
      const conversation = { provider, sessionId: "old-code-thread", codeParentMessageId: "p1", qwenAccountId: "account-a" };
      migrateLegacyCodeSession(conversation);
      assert.equal(conversation.codeSessionId, "old-code-thread", provider);
      assert.equal(conversation.sessionId, null, provider);
      if (provider === "qwen") {
        assert.equal(conversation.qwenCodeAccountId, "account-a");
        assert.equal(conversation.qwenAccountId, null);
      }
    }
  });
  it("detaches a legacy Google AI tool-protocol URL from ordinary chat even without a code parent", () => {
    const conversation = {
      provider: "googleai",
      sessionId: "https://www.google.com/search?q=LOCAL+WORKSPACE+TOOLS",
      codeSessionId: "separate-code-thread",
      codeParentMessageId: null,
    };
    migrateLegacyCodeSession(conversation);
    assert.equal(conversation.sessionId, null);
    assert.equal(conversation.codeSessionId, "separate-code-thread");
  });
  it("keeps actionable work in Coder even when an old chat stored coderMode=false", () => {
    const input = resolveConversationAgentTask("исправь ошибку в проекте", {
      provider: "glm",
      coderMode: false,
      hardwareMode: false,
    }, { autoCodeMode: shouldAutoRunCodeTask("исправь ошибку в проекте") });
    assert.equal(input.run, true);
    assert.equal(input.task, "исправь ошибку в проекте");
  });

  it("routes a ChatGPT chat through the code agent when Coder is enabled", () => {
    const input = resolveConversationAgentTask("исправь ошибку в проекте", {
      provider: "chatgpt",
      coderMode: true,
      hardwareMode: false,
    }, { autoCodeMode: shouldAutoRunCodeTask("исправь ошибку в проекте") });
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

  it("keeps short conversational replies in the Coder agent", () => {
    const conversation = {
      provider: "glm",
      coderMode: true,
      hardwareMode: false,
    };

    assert.equal(resolveConversationAgentTask("круто", conversation).run, true);
    assert.equal(resolveConversationAgentTask("спасибо!", conversation).run, true);
    assert.equal(resolveConversationAgentTask("что ты за модель?", conversation).run, true);
    assert.equal(resolveConversationAgentTask("/code круто", conversation).run, true);
    assert.equal(resolveConversationAgentTask("удали файл", conversation, { autoCodeMode: shouldAutoRunCodeTask("удали файл") }).run, true);
  });

  it("keeps informational Google AI questions in the enabled Coder agent", () => {
    const conversation = { provider: "googleai", coderMode: true, hardwareMode: false };
    const prompt = "в интернете посмотри какая версия последняя гемини?";
    assert.equal(resolveConversationAgentTask(prompt, conversation, { autoCodeMode: false, autoBrowserMode: false }).run, true);
    assert.equal(resolveConversationAgentTask("/code " + prompt, conversation).run, true);
  });
});

describe("ChatGPT login recovery", () => {
  it("opens the embedded browser when the saved session has no usable composer", () => {
    const marked = new Error("ChatGPT composer is unavailable");
    marked.needsChatGPTLogin = true;

    assert.equal(isChatGPTLoginRecoveryRequired(marked), true);
    assert.equal(
      isChatGPTLoginRecoveryRequired(new Error("ChatGPT: вход есть, но поле ввода не отрисовалось")),
      true,
    );
    assert.equal(isChatGPTLoginRecoveryRequired(new Error("provider returned HTTP 500")), false);
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
