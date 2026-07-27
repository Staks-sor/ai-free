import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { normalizeChatGPTAssistantText } from "../src/providers/chatgpt/browser-proxy.mjs";
import {
  getChatGPTBrowserLaunchOptions,
  tryAssistCloudflareClick,
} from "../src/providers/chatgpt/browser-login.mjs";

describe("getChatGPTBrowserLaunchOptions", () => {
  const envKeys = ["CHATGPT_HEADLESS", "CHATGPT_EMBED_IN_UI", "CHATGPT_EMBED_HEADED"];
  let saved = {};

  beforeEach(() => {
    saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
    for (const k of envKeys) delete process.env[k];
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to the in-app browser", () => {
    assert.deepEqual(getChatGPTBrowserLaunchOptions(), {
      useExternalChrome: false,
      headless: false,
      offscreen: true,
      internalHeadless: false,
      preferBundled: false,
      applyStealth: false,
    });
  });

  it("keeps external Chrome as an explicit legacy mode", () => {
    process.env.CHATGPT_EMBED_IN_UI = "0";
    assert.equal(getChatGPTBrowserLaunchOptions().useExternalChrome, true);
  });

  it("embed UI defers to in-app real Chrome (useExternalChrome false)", () => {
    process.env.CHATGPT_EMBED_IN_UI = "1";
    assert.deepEqual(getChatGPTBrowserLaunchOptions(), {
      useExternalChrome: false,
      headless: false,
      offscreen: true,
      internalHeadless: false,
      preferBundled: false,
      applyStealth: false,
    });
  });

  it("allows headless only when CHATGPT_EMBED_HEADED=0", () => {
    process.env.CHATGPT_EMBED_IN_UI = "1";
    process.env.CHATGPT_EMBED_HEADED = "0";
    assert.deepEqual(getChatGPTBrowserLaunchOptions(), {
      useExternalChrome: false,
      headless: true,
      offscreen: false,
      internalHeadless: true,
      preferBundled: false,
      applyStealth: false,
    });
  });

  it("respects explicit CHATGPT_HEADLESS=1", () => {
    process.env.CHATGPT_EMBED_IN_UI = "1";
    process.env.CHATGPT_HEADLESS = "1";
    assert.deepEqual(getChatGPTBrowserLaunchOptions(), {
      useExternalChrome: true,
      headless: true,
      offscreen: false,
      internalHeadless: true,
      preferBundled: false,
      applyStealth: false,
    });
  });
});

describe("normalizeChatGPTAssistantText", () => {
  it("unwraps finish tool JSON", () => {
    const raw = '{"tool":"finish","message":"Приветик! 👋 Чем могу помочь?"}';
    assert.equal(normalizeChatGPTAssistantText(raw), "Приветик! 👋 Чем могу помочь?");
  });

  it("unwraps fenced tool JSON", () => {
    const raw = '```json\n{"tool":"finish","message":"done"}\n```';
    assert.equal(normalizeChatGPTAssistantText(raw), "done");
  });

  it("returns plain text unchanged", () => {
    assert.equal(normalizeChatGPTAssistantText("Привет"), "Привет");
  });
});

describe("tryAssistCloudflareClick", () => {
  it("forwards human-like click without forced second CAPTCHA click", async () => {
    const events = [];
    const page = {
      mouse: {
        move: async (x, y, opts) => events.push(["move", x, y, opts?.steps]),
        down: async () => events.push(["down"]),
        up: async () => events.push(["up"]),
      },
      frames: () => [],
      locator: () => ({ first: () => ({ count: async () => 0 }) }),
    };

    assert.equal(await tryAssistCloudflareClick(page, 120, 240), true);
    assert.ok(events.some((e) => e[0] === "move" && e[1] === 120));
    assert.deepEqual(events.filter((e) => e[0] === "down" || e[0] === "up"), [["down"], ["up"]]);
  });
});

describe("persistent ChatGPT login profile", () => {
  it("does not clear the dedicated Chrome profile during a normal re-login", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../src/providers/chatgpt/browser-login.mjs", import.meta.url), "utf8"),
    );
    const loginStart = source.indexOf("export async function loginChatGPTAndSave");
    const loginBody = source.slice(loginStart);
    assert.match(loginBody, /await closeChatGPTBrowserProxy\(\)/);
    assert.match(loginBody, /prepareChromeProfileForLaunch\(profileDir, \{ clearCookies: false \}\)/);
    assert.match(loginBody, /clearCookies: false,\s+skipKillStale: true/);
    assert.doesNotMatch(loginBody, /repairChatGPTBrowserProfile\(profileDir\)/);
    assert.doesNotMatch(loginBody, /await clearBrowserCookiesViaCdp\(page, context\)/);
  });
});
