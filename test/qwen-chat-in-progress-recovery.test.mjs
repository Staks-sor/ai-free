// Тестируем автоматическое восстановление Qwen при «The chat is in progress!»:
// после мягких повторов в тот же chat_id клиент создаёт НОВЫЙ чат и повторяет
// запрос туда, возвращая recoveredChatId. Адаптер /code закрепляет этот чат.
//
// ВАЖНО: QWEN_TRANSPORT=direct ставим ДО импорта клиента, чтобы не поднимать
// Playwright-браузер в тестах. Прямой fetch глушим на globalThis.
import assert from "node:assert/strict";
import { describe, it, before, after, beforeEach } from "node:test";

process.env.QWEN_TRANSPORT = "direct";
process.env.QWEN_MODEL = "qwen3-max";
// Авто-режим: короткие паузы и маленький лимит, чтобы тесты не висели минуты.
process.env.QWEN_AUTO_RETRY_MAX_ATTEMPTS = "4";
process.env.QWEN_AUTO_RETRY_BASE_DELAY_MS = "1";
process.env.QWEN_AUTO_RETRY_MAX_DELAY_MS = "5";

const qwenClientModule = await import("../src/providers/qwen/client.mjs");
const { QwenChatClient, formatQwenUserFacingError, formatQwenStreamError, isQwenInvalidParentError } = qwenClientModule;
const { createQwenAgentAdapter } = await import("../src/providers/qwen/agent-adapter.mjs");

function chatInProgressJson() {
  return JSON.stringify({
    success: false,
    data: { code: "Bad_Request", details: "The chat is in progress!" },
  });
}

function invalidParentJson() {
  return JSON.stringify({
    success: false,
    data: { code: "Bad_Request", details: "Invalid input chat parent_id old-msg is not exist." },
  });
}

function successJson(text = "OK", messageId = "msg-1") {
  return JSON.stringify({
    success: true,
    data: { content: [{ type: "text", content: { text } }], message_id: messageId },
  });
}

function makeResponse(text, contentType = "application/json", ok = true, status = 200) {
  return {
    ok,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => text,
  };
}

describe("Qwen chat-in-progress recovery (client)", () => {
  let originalFetch;
  let fetchImpl;
  let createChatCalls;

  before(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (...args) => fetchImpl(...args);
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    fetchImpl = null;
    createChatCalls = [];
  });

  it("creates a fresh chat and returns recoveredChatId when stuck in-progress", async () => {
    let completeCalls = 0;
    fetchImpl = async (url) => {
      completeCalls += 1;
      const u = String(url);
      // createChat в direct-режиме НЕ дёргает fetch (возвращает клиентский UUID),
      // поэтому здесь только запросы /completions.
      assert.ok(u.includes("/completions"), `unexpected url: ${u}`);
      // Первые запросы в исходный чат → in progress.
      if (completeCalls === 1) return makeResponse(chatInProgressJson(), "application/json", true, 200);
      // После восстановления (новый chat_id) → успех.
      return makeResponse(successJson("recovered answer", "fresh-msg-id"));
    };

    const client = new QwenChatClient({ token: "t", cookieHeader: "c=x", debug: false });
    // Глушим createChat, чтобы возвращать детерминированный id и фиксировать вызов.
    client.createChat = async (opts) => {
      createChatCalls.push(opts);
      return "fresh-chat-xyz";
    };

    const result = await client.complete({
      chatId: "stuck-chat",
      prompt: "привет",
      thinking: false,
      search: false,
    });

    assert.equal(createChatCalls.length, 1, "createChat called exactly once during recovery");
    assert.equal(result.recoveredChatId, "fresh-chat-xyz");
    assert.equal(result.lastMessageId, "fresh-msg-id");
    assert.match(String(result.text), /recovered answer/);
    assert.equal(completeCalls, 2, "1 stuck attempt (direct, no soft retries) + 1 fresh-chat success");
  });

  it("recovers automatically when Qwen no longer recognizes parent_id", async () => {
    let completeCalls = 0;
    const seenBodies = [];
    fetchImpl = async (_url, options) => {
      completeCalls += 1;
      seenBodies.push(JSON.parse(options.body));
      if (completeCalls === 1) return makeResponse(invalidParentJson());
      return makeResponse(successJson("parent recovered", "new-parent"));
    };

    const client = new QwenChatClient({ token: "t", cookieHeader: "c=x", debug: false });
    client.createChat = async () => "fresh-parent-chat";
    const result = await client.complete({
      chatId: "old-chat",
      parentId: "old-msg",
      prompt: "продолжай",
      thinking: false,
      search: false,
    });

    assert.equal(completeCalls, 2);
    assert.equal(result.recoveredChatId, "fresh-parent-chat");
    assert.equal(result.lastMessageId, "new-parent");
    assert.equal(seenBodies[0].parent_id, "old-msg");
    assert.equal(seenBodies[1].parent_id, null, "fresh chat must not reuse stale parent_id");
  });

  it("falls back to a user-friendly message when fresh chat is also stuck", async () => {
    fetchImpl = async () => makeResponse(chatInProgressJson(), "application/json", true, 200);

    const client = new QwenChatClient({ token: "t", cookieHeader: "c=x", debug: false });
    client.createChat = async () => "fresh2";

    const result = await client.complete({ chatId: "stuck2", prompt: "x", thinking: false, search: false });

    assert.equal(result.recoveredChatId, undefined);
    assert.equal(result.chatInProgress, true);
    assert.match(String(result.text), /Qwen сейчас занят/i);
    assert.match(String(result.text), /новый разговор|новый чат/i);
  });

  it("does NOT create a fresh chat when allowNewChatRecovery=false", async () => {
    let completeCalls = 0;
    fetchImpl = async () => {
      completeCalls += 1;
      return makeResponse(chatInProgressJson(), "application/json", true, 200);
    };

    const client = new QwenChatClient({ token: "t", cookieHeader: "c=x", debug: false });
    let createChatCalled = false;
    client.createChat = async () => { createChatCalled = true; return "should-not"; };

    const result = await client.complete({
      chatId: "stuck3",
      prompt: "x",
      thinking: false,
      search: false,
      allowNewChatRecovery: false,
    });

    assert.equal(createChatCalled, false, "createChat must NOT be called when recovery disabled");
    assert.equal(result.recoveredChatId, undefined);
    assert.equal(result.chatInProgress, true);
    assert.equal(completeCalls, 1, "direct transport: single complete attempt, no soft-retry loop");
  });
});

describe("Qwen chat-in-progress recovery (agent adapter)", () => {
  it("sticks to the recovered chat_id for subsequent complete() calls", async () => {
    const calls = [];
    const fakeClient = {
      async complete(opts) {
        calls.push(opts);
        if (opts.chatId === "orig") {
          return { text: "ans-1", lastMessageId: "m1", recoveredChatId: "recovered-7" };
        }
        return { text: "ans-2", lastMessageId: "m2" };
      },
    };
    const adapter = createQwenAgentAdapter(fakeClient);

    const r1 = await adapter.complete({ sessionId: "orig", prompt: "p1" });
    assert.equal(r1.text, "ans-1");
    assert.equal(r1.lastAssistantMessageId, "m1");

    const r2 = await adapter.complete({ sessionId: "orig", prompt: "p2" });
    assert.equal(r2.text, "ans-2");
    assert.equal(r2.lastAssistantMessageId, "m2");
    assert.equal(calls[1].chatId, "recovered-7", "second call uses recovered chat_id");
    assert.notEqual(calls[1].chatId, "orig");
  });

  it("does not change chat when no recovery happened", async () => {
    const calls = [];
    const fakeClient = {
      async complete(opts) {
        calls.push(opts);
        return { text: "plain", lastMessageId: "m" };
      },
    };
    const adapter = createQwenAgentAdapter(fakeClient);
    await adapter.complete({ sessionId: "sess-A", prompt: "p1" });
    await adapter.complete({ sessionId: "sess-A", prompt: "p2" });
    assert.equal(calls[0].chatId, "sess-A");
    assert.equal(calls[1].chatId, "sess-A");
  });
});

describe("Qwen chat-in-progress user-facing message", () => {
  it("formats a readable hint instead of raw Bad_Request", () => {
    const msg = formatQwenUserFacingError("Bad_Request", "The chat is in progress!");
    assert.match(msg, /Qwen сейчас занят/i);
    assert.doesNotMatch(msg, /Bad_Request/);
    assert.doesNotMatch(msg, /The chat is in progress/);
  });

  it("formatQwenStreamError surfaces the readable hint for success=false JSON", () => {
    const msg = formatQwenStreamError({
      success: false,
      data: { code: "Bad_Request", details: "The chat is in progress!" },
    });
    assert.ok(msg);
    assert.match(msg, /Qwen сейчас занят/i);
  });
});

describe("Qwen chat-in-progress auto-retry mode (autoRetry=true)", () => {
  let originalFetch;
  let fetchImpl;
  let createChatCalls;

  before(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (...args) => fetchImpl(...args);
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    fetchImpl = null;
    createChatCalls = [];
  });

  it("retries fresh chats multiple times and succeeds on a later attempt", async () => {
    let completeCalls = 0;
    fetchImpl = async (url) => {
      completeCalls += 1;
      const u = String(url);
      assert.ok(u.includes("/completions"), `unexpected url: ${u}`);
      // Первые два свежих чата — тоже застряли. Третий — успех.
      // direct-транспорт: один complete-запрос на чат (без мягких повторов).
      if (completeCalls <= 3) return makeResponse(chatInProgressJson(), "application/json", true, 200);
      return makeResponse(successJson("auto-recovered", "auto-msg-id"));
    };

    const client = new QwenChatClient({ token: "t", cookieHeader: "c=x", debug: false });
    let chatSeq = 0;
    client.createChat = async (opts) => {
      chatSeq += 1;
      createChatCalls.push(opts);
      return `fresh-${chatSeq}`;
    };

    const result = await client.complete({
      chatId: "stuck-auto",
      prompt: "делай задачу",
      thinking: false,
      search: false,
      autoRetry: true,
    });

    // Исходный чат застрял + 3 неудачных свежих + 1 успешный = 4 complete-запроса? Нет:
    // completeCalls: 1 (orig, stuck) → create fresh-1 → 2 (fresh-1, stuck) → create fresh-2
    // → 3 (fresh-2, stuck) → create fresh-3 → 4 (fresh-3, success).
    assert.equal(completeCalls, 4, "orig + 3 fresh chats = 4 completion requests");
    assert.equal(createChatCalls.length, 3, "three fresh chats created before success");
    assert.equal(result.recoveredChatId, "fresh-3");
    assert.equal(result.lastMessageId, "auto-msg-id");
    assert.match(String(result.text), /auto-recovered/);
  });

  it("gives up with a readable message after exhausting all auto-retry attempts", async () => {
    fetchImpl = async () => makeResponse(chatInProgressJson(), "application/json", true, 200);

    const client = new QwenChatClient({ token: "t", cookieHeader: "c=x", debug: false });
    let chatSeq = 0;
    client.createChat = async () => {
      chatSeq += 1;
      return `fresh-${chatSeq}`;
    };

    const result = await client.complete({
      chatId: "stuck-forever",
      prompt: "x",
      thinking: false,
      search: false,
      autoRetry: true,
    });

    // QWEN_AUTO_RETRY_MAX_ATTEMPTS=4 → ровно 4 свежих чата, затем сдаёмся.
    assert.equal(chatSeq, 4, "exactly 4 fresh chats tried before giving up");
    assert.equal(result.recoveredChatId, undefined);
    assert.equal(result.chatInProgress, true);
    assert.match(String(result.text), /Qwen сейчас занят/i);
  });

  it("interactive mode (autoRetry=false) still stops after one fresh chat", async () => {
    let completeCalls = 0;
    fetchImpl = async () => {
      completeCalls += 1;
      return makeResponse(chatInProgressJson(), "application/json", true, 200);
    };

    const client = new QwenChatClient({ token: "t", cookieHeader: "c=x", debug: false });
    let chatSeq = 0;
    client.createChat = async () => {
      chatSeq += 1;
      return `fresh-${chatSeq}`;
    };

    const result = await client.complete({
      chatId: "stuck-interactive",
      prompt: "x",
      thinking: false,
      search: false,
      autoRetry: false,
    });

    assert.equal(chatSeq, 1, "interactive mode: exactly one fresh chat, then give up");
    assert.equal(result.recoveredChatId, undefined);
    assert.equal(result.chatInProgress, true);
  });
});

describe("Qwen chat-in-progress auto-retry (agent adapter enables autoRetry)", () => {
  it("adapter passes autoRetry=true to the underlying client", async () => {
    const calls = [];
    // Fake-клиент имитирует успешное авто-восстановление за ОДИН вызов complete()
    // (как это делает реальный #completeWithRecovery с autoRetry=true): исходный
    // чат застрял, но клиент сам создал новый и вернул успех + recoveredChatId.
    const fakeClient = {
      async complete(opts) {
        calls.push(opts);
        assert.equal(opts.autoRetry, true, "underlying client must receive autoRetry=true");
        return { text: "done", lastMessageId: "m-final", recoveredChatId: "auto-fresh" };
      },
    };
    const adapter = createQwenAgentAdapter(fakeClient);
    const r = await adapter.complete({ sessionId: "orig-auto", prompt: "p" });
    // Главный invariant: адаптер включает авто-режим для /code-агента/ACP.
    assert.equal(calls.length, 1, "adapter calls underlying client exactly once");
    assert.equal(calls[0].autoRetry, true, "adapter must enable auto-retry mode");
    // Адаптер закрепляет восстановленный чат и переименовывает поля.
    assert.equal(r.lastAssistantMessageId, "m-final");
  });
});

// Regression: raw parent_id errors must be classified before generic Bad_Request handling.
assert.equal(isQwenInvalidParentError({ error: "Bad_Request" }, "Invalid input chat parent_id abc is not exist."), true);
