import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { cloudflareChallengeEvaluator } from "../src/providers/chatgpt/cloudflare-challenge.mjs";

describe("cloudflareChallengeEvaluator", () => {
  const savedDocument = global.document;
  const savedGetComputedStyle = global.getComputedStyle;

  afterEach(() => {
    global.document = savedDocument;
    global.getComputedStyle = savedGetComputedStyle;
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

  it("does not treat a composer behind the login modal as ready", () => {
    const modal = { getBoundingClientRect: () => ({ width: 500, height: 500 }) };
    global.getComputedStyle = () => ({ display: "block", visibility: "visible" });
    global.document = {
      title: "ChatGPT",
      body: { innerText: "С возвращением" },
      querySelector: (selector) => {
        if (selector.includes("modal-no-auth-login")) return modal;
        if (selector.includes("prompt-textarea")) return {};
        return null;
      },
    };
    global.location = { href: "https://chatgpt.com/" };
    const state = cloudflareChallengeEvaluator();
    assert.equal(state.loginRequired, true);
    assert.equal(state.hasComposer, false);
  });
});
