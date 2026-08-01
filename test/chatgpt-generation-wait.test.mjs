import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getChatGPTGenerationWaitFailure,
  hasChatGPTResponseChanged,
  selectPreferredChatGPTAssistantText,
} from "../src/providers/chatgpt/browser-proxy.mjs";

describe("ChatGPT generation wait", () => {
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
