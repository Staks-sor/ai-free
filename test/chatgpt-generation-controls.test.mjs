import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countVisibleChatGPTControls } from "../src/providers/chatgpt/browser-proxy.mjs";

describe("ChatGPT generation controls", () => {
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
