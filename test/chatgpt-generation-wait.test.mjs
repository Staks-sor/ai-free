import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getChatGPTGenerationWaitFailure } from "../src/providers/chatgpt/browser-proxy.mjs";

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
});
