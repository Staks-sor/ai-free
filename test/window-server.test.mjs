import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { shouldAutoRunBrowserTask } from "../src/window-app/browser-snapshot.mjs";
import {
  captureRunningClarification,
  takeRunningClarifications,
  isChatGPTLoginRecoveryRequired,
  listenLoopbackWithRetry,
  shouldAutoRunCodeTask,
} from "../src/window-app/server.mjs";
import { resolveConversationAgentTask } from "../src/window-app/agent-task.mjs";
import http from "node:http";

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

describe("listenLoopbackWithRetry", () => {
  const findFreePort = () => new Promise((resolve, reject) => {
    const probe = http.createServer(() => {});
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
    probe.once("error", reject);
  });

  it("binds immediately when the port is free", async () => {
    const port = await findFreePort();
    const server = http.createServer(() => {});
    await listenLoopbackWithRetry(server, port);
    assert.equal(server.address().port, port);
    server.close();
  });

  it("waits out a shutting-down previous instance and then binds", async () => {
    const port = await findFreePort();
    const holder = http.createServer(() => {});
    await new Promise((resolve) => holder.listen(port, "127.0.0.1", resolve));
    // "Старый инстанс" освобождает порт через 300 мс (graceful shutdown).
    setTimeout(() => holder.close(), 300);

    const server = http.createServer(() => {});
    const retries = [];
    await listenLoopbackWithRetry(server, port, {
      retries: 20,
      delayMs: 50,
      onRetry: (attempt) => retries.push(attempt),
    });
    assert.equal(server.address().port, port);
    assert.ok(retries.length >= 1, "expected at least one retry while the port was held");
    server.close();
  });

  it("rejects with EADDRINUSE after exhausting retries", async () => {
    const port = await findFreePort();
    const holder = http.createServer(() => {});
    await new Promise((resolve) => holder.listen(port, "127.0.0.1", resolve));
    const server = http.createServer(() => {});
    await assert.rejects(
      listenLoopbackWithRetry(server, port, { retries: 2, delayMs: 10 }),
      (error) => error.code === "EADDRINUSE",
    );
    holder.close();
    server.close();
  });

  it("does not retry non-EADDRINUSE errors", async () => {
    const server = http.createServer(() => {});
    // Невалидный порт — ошибка не EADDRINUSE, ретраев быть не должно.
    await assert.rejects(
      listenLoopbackWithRetry(server, -1, { retries: 3, delayMs: 10, onRetry: () => { throw new Error("must not retry"); } }),
    );
    server.close();
  });
});

