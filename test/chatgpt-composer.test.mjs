import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fillChatGPTComposer } from "../src/providers/chatgpt/browser-proxy.mjs";

describe("fillChatGPTComposer", () => {
  it("reacquires the composer when ChatGPT replaces or disables the fallback textarea", async () => {
    const calls = [];
    let lookup = 0;
    const stale = {
      isVisible: async () => true,
      isEnabled: async () => false,
    };
    const active = {
      isVisible: async () => true,
      isEnabled: async () => true,
      click: async () => calls.push("click"),
      fill: async (value) => calls.push(["fill", value]),
    };
    const page = {
      locator() {
        lookup += 1;
        const item = lookup === 1 ? stale : active;
        return {
          count: async () => 1,
          nth: () => item,
        };
      },
      waitForTimeout: async () => {},
      keyboard: { insertText: async (value) => calls.push(["insertText", value]) },
    };

    await fillChatGPTComposer(page, "проверка", { timeoutMs: 100 });

    assert.ok(lookup >= 2);
    assert.deepEqual(calls, ["click", ["fill", "проверка"]]);
  });

  it("retries after a detached composer instead of waiting on a stale locator", async () => {
    const calls = [];
    let lookup = 0;
    const detached = {
      isVisible: async () => true,
      isEnabled: async () => true,
      click: async () => { throw new Error("Element was detached from the DOM"); },
    };
    const active = {
      isVisible: async () => true,
      isEnabled: async () => true,
      click: async () => calls.push("click"),
      fill: async (value) => calls.push(["fill", value]),
    };
    const page = {
      locator() {
        lookup += 1;
        const item = lookup === 1 ? detached : active;
        return { count: async () => 1, nth: () => item };
      },
      waitForTimeout: async () => {},
      keyboard: { insertText: async (value) => calls.push(["insertText", value]) },
    };

    await fillChatGPTComposer(page, "повтор", { timeoutMs: 100 });

    assert.ok(lookup >= 2);
    assert.deepEqual(calls, ["click", ["fill", "повтор"]]);
  });
});
