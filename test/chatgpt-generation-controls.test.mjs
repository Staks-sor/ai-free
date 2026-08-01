import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHATGPT_GENERATION_STOP_SELECTOR,
  countVisibleChatGPTControls,
} from "../src/providers/chatgpt/browser-proxy.mjs";

describe("ChatGPT generation controls", () => {
  it("does not confuse response action buttons with active generation", () => {
    assert.doesNotMatch(CHATGPT_GENERATION_STOP_SELECTOR, /aria-label\*=/);
    assert.doesNotMatch(CHATGPT_GENERATION_STOP_SELECTOR, /Stop|Останов/);
    assert.match(CHATGPT_GENERATION_STOP_SELECTOR, /data-testid=["']stop-button["']/);
  });
  it("ignores detached or hidden stop buttons left by the ChatGPT SPA", async () => {
    const states = [false, true, false];
    const locator = {
      count: async () => states.length,
      nth: (index) => ({ isVisible: async () => states[index] }),
    };

    assert.equal(await countVisibleChatGPTControls(locator), 1);
  });

  it("treats locator failures as invisible controls", async () => {
    const locator = {
      count: async () => 2,
      nth: (index) => ({
        isVisible: async () => {
          if (index === 0) throw new Error("detached");
          return false;
        },
      }),
    };

    assert.equal(await countVisibleChatGPTControls(locator), 0);
  });
});
