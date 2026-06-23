import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { cloudflareChallengeEvaluator } from "../src/providers/chatgpt/cloudflare-challenge.mjs";

describe("cloudflareChallengeEvaluator", () => {
  const savedDocument = global.document;

  afterEach(() => {
    global.document = savedDocument;
  });

  it("does not flag challenge when composer is visible", () => {
    global.document = {
      title: "ChatGPT",
      body: { innerText: "cloudflare mentioned in footer" },
      querySelector: (sel) => (sel.includes("prompt-textarea") ? {} : null),
    };
    global.location = { href: "https://chatgpt.com/" };
    const state = cloudflareChallengeEvaluator();
    assert.equal(state.challenge, false);
    assert.equal(state.hasComposer, true);
  });

  it("flags turnstile iframe as challenge", () => {
    global.document = {
      title: "ChatGPT",
      body: { innerText: "Подтвердите, что вы человек" },
      querySelector: (sel) => (sel.includes("iframe") ? {} : null),
    };
    global.location = { href: "https://chatgpt.com/" };
    const state = cloudflareChallengeEvaluator();
    assert.equal(state.challenge, true);
  });
});
