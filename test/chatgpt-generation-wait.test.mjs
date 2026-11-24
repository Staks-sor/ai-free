import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findChatGPTSavedResponse,
  getChatGPTSubmittedTurn,
  getChatGPTGenerationWaitFailure,
  hasChatGPTResponseChanged,
  selectPreferredChatGPTAssistantText,
} from "../src/providers/chatgpt/browser-proxy.mjs";

describe("ChatGPT generation wait", () => {
  it("captures the user message ID from the native conversation POST", () => {
    const request = {
      method: () => "POST",
      url: () => "https://chatgpt.com/backend-api/f/conversation",
      postDataJSON: () => ({ conversation_id: "chat", messages: [
        { id: "user-turn", author: { role: "user" }, content: { parts: ["serialized prompt"] } },
      ] }),
    };
    assert.deepEqual(getChatGPTSubmittedTurn(request), { userMessageId: "user-turn", conversationId: "chat" });
    assert.equal(getChatGPTSubmittedTurn({ ...request, method: () => "GET" }), null);
    assert.equal(getChatGPTSubmittedTurn({ ...request, url: () => "https://chatgpt.com/backend-api/conversation/chat" }), null);
  });

  it("matches an editor-transformed code prompt by submitted message ID", async () => {
    const sentAtMs = Date.parse("2026-10-08T17:24:43Z");
    const fetchImpl = async () => ({
      ok: true,
      async json() {
        return { current_node: "answer", mapping: {
          user: { parent: null, message: { id: "user-turn", author: { role: "user" }, content: { parts: ["Read \\`PROJECT_CONTEXT.md\\` before implementation. Then inspect code."] }, create_time: sentAtMs / 1000 } },
          answer: { parent: "user", message: { id: "answer", author: { role: "assistant" }, status: "finished_successfully", content: { parts: ["Готовый ответ"] }, create_time: sentAtMs / 1000 + 2 } },
        } };
      },
    });
    const options = { accessToken: "token", prompt: "Read `PROJECT_CONTEXT.md` before implementation.\nThen inspect code.", sentAtMs, conversationId: "chat", fetchImpl };
    assert.deepEqual(await findChatGPTSavedResponse({ ...options, userMessageId: "user-turn" }), { conversationId: "chat", id: "answer", text: "Готовый ответ" });
    assert.equal(await findChatGPTSavedResponse({ ...options, userMessageId: "different-turn" }), null);
    assert.equal(await findChatGPTSavedResponse(options), null);
  });

  it("recovers a completed reply from a new saved conversation when the page observer misses it", async () => {
    const sentAtMs = Date.parse("2026-09-30T08:33:48Z");
    const fetchImpl = async (url) => ({
      ok: true,
      async json() {
        if (url.includes("/conversations?")) return { items: [
          { id: "older", create_time: "2026-09-30T08:30:00Z" },
          { id: "new", create_time: "2026-09-30T08:33:49Z" },
        ] };
        return {
          current_node: "answer",
          mapping: {
            user: { parent: null, message: { author: { role: "user" }, content: { parts: ["ау"] }, create_time: sentAtMs / 1000 } },
            answer: { parent: "user", message: { id: "answer", author: { role: "assistant" }, status: "finished_successfully", content: { parts: ["Я здесь."] }, create_time: sentAtMs / 1000 + 2 } },
          },
        };
      },
    });

    const result = await findChatGPTSavedResponse({
      accessToken: "token",
      cookies: [],
      prompt: "ау",
      sentAtMs,
      fetchImpl,
    });
    assert.deepEqual(result, { conversationId: "new", id: "answer", text: "Я здесь." });
  });

  it("does not return an older answer or an unfinished generation", async () => {
    const sentAtMs = Date.parse("2026-09-30T08:33:48Z");
    const fetchImpl = async () => ({
      ok: true,
      async json() {
        return {
          current_node: "answer",
          mapping: {
            user: { parent: null, message: { author: { role: "user" }, content: { parts: ["ау"] }, create_time: sentAtMs / 1000 } },
            answer: { parent: "user", message: { id: "answer", author: { role: "assistant" }, status: "in_progress", content: { parts: ["Черновик"] }, create_time: sentAtMs / 1000 + 2 } },
          },
        };
      },
    });
    assert.equal(await findChatGPTSavedResponse({ accessToken: "token", prompt: "ау", sentAtMs, conversationId: "existing", fetchImpl }), null);
    assert.equal(await findChatGPTSavedResponse({ accessToken: "token", prompt: "другой вопрос", sentAtMs, conversationId: "existing", fetchImpl }), null);
  });

  it("does not reuse a finished answer from a previous identical prompt", async () => {
    const sentAtMs = Date.parse("2026-09-30T08:33:48Z");
    const fetchImpl = async () => ({
      ok: true,
      async json() {
        return {
          current_node: "answer",
          mapping: {
            user: { parent: null, message: { author: { role: "user" }, content: { parts: ["ау"] }, create_time: sentAtMs / 1000 - 30 } },
            answer: { parent: "user", message: { id: "answer", author: { role: "assistant" }, status: "finished_successfully", content: { parts: ["Старый ответ"] }, create_time: sentAtMs / 1000 - 28 } },
          },
        };
      },
    });
    assert.equal(await findChatGPTSavedResponse({ accessToken: "token", prompt: "ау", sentAtMs, conversationId: "existing", fetchImpl }), null);
  });

  it("fails quickly when ChatGPT never starts a response", () => {
    assert.equal(
      getChatGPTGenerationWaitFailure({
        elapsedMs: 45_001,
        sawGeneration: false,
        pageError: "",
        startTimeoutMs: 45_000,
      }),
      "ChatGPT не начал формировать ответ за 45 секунд.",
    );
  });

  it("surfaces a visible ChatGPT error instead of waiting for the full generation timeout", () => {
    assert.equal(
      getChatGPTGenerationWaitFailure({
        elapsedMs: 2_000,
        sawGeneration: false,
        pageError: "Something went wrong while generating the response",
        startTimeoutMs: 45_000,
      }),
      "ChatGPT сообщил об ошибке: Something went wrong while generating the response",
    );
  });

  it("keeps waiting after generation has started", () => {
    assert.equal(
      getChatGPTGenerationWaitFailure({
        elapsedMs: 60_000,
        sawGeneration: true,
        pageError: "",
        startTimeoutMs: 45_000,
      }),
      "",
    );
  });

  it("recognizes a completed response when ChatGPT reuses the same DOM message count", () => {
    assert.equal(hasChatGPTResponseChanged(
      { count: 2, id: "old", text: "Предыдущий ответ" },
      { count: 2, id: "new", text: "Останавливаюсь" },
    ), true);
  });

  it("recognizes changed text even when ChatGPT reuses the same message node and id", () => {
    assert.equal(hasChatGPTResponseChanged(
      { count: 2, id: "same", text: "Предыдущий ответ" },
      { count: 2, id: "same", text: "Останавливаюсь" },
    ), true);
  });

  it("does not mistake the unchanged previous response for a new answer", () => {
    assert.equal(hasChatGPTResponseChanged(
      { count: 2, id: "same", text: "Предыдущий ответ" },
      { count: 2, id: "same", text: "Предыдущий ответ" },
    ), false);
  });

  it("prefers the newest complete DOM text without calling the removed streaming reader", () => {
    assert.equal(
      selectPreferredChatGPTAssistantText("Короткий ответ", "Короткий ответ с завершением"),
      "Короткий ответ с завершением",
    );
    assert.equal(
      selectPreferredChatGPTAssistantText("Полный ответ из API", "Короткий DOM"),
      "Полный ответ из API",
    );
  });
});
