import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldRetryChatGPTBrowserSend } from "../src/providers/chatgpt/browser-proxy.mjs";

describe("ChatGPT browser retry safety", () => {
  it("retries a transient browser failure before the prompt was submitted", () => {
    assert.equal(
      shouldRetryChatGPTBrowserSend(new Error("Execution context was destroyed"), false),
      true,
    );
  });

  it("never submits the same prompt again after the first click succeeded", () => {
    assert.equal(
      shouldRetryChatGPTBrowserSend(new Error("Execution context was destroyed"), true),
      false,
    );
  });
});
