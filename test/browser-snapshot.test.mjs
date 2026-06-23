import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatBrowserContextBlock,
} from "../src/window-app/browser-snapshot.mjs";
import { renderEmbedBrowserHtml } from "../src/window-app/embed-browser.mjs";
import { renderEmbedAppBrowserLiveHtml } from "../src/window-app/app-browser-live.mjs";

describe("browser-snapshot", () => {
  it("formats non-empty snapshot", () => {
    const block = formatBrowserContextBlock({
      ok: true,
      empty: false,
      url: "https://example.com",
      title: "Example",
      text: "Hello world",
    });
    assert.match(block, /https:\/\/example.com/);
    assert.match(block, /Hello world/);
  });

  it("skips empty snapshot", () => {
    assert.equal(formatBrowserContextBlock({ ok: true, empty: true, url: "about:blank" }), "");
  });

  it("includes clickable elements", () => {
    const block = formatBrowserContextBlock({
      ok: true,
      empty: false,
      url: "https://consent.google.com/",
      format: "accessibility-v2",
      text: "Accept all",
      tree: '- button "Accept all" [e1]',
      refs: [{ ref: "e1", role: "button", name: "Accept all" }],
    });
    assert.match(block, /Accept all/);
    assert.match(block, /\[e1\]/);
  });

  it("builds prompt prefix from snapshot block", () => {
    const section = formatBrowserContextBlock({
      ok: true,
      empty: false,
      url: "https://example.com",
      text: "Page body",
    });
    const out = [section, "", "Question"].join("\n");
    assert.match(out, /Page body/);
    assert.match(out, /Question/);
  });
});

describe("embed browser ui", () => {
  it("defaults to chatgpt tab", () => {
    const html = renderEmbedBrowserHtml();
    assert.match(html, /tabChatgpt/);
    assert.match(html, /setTab\("chatgpt"\)|setTab\(currentTab\)/);
    assert.match(html, /CHATGPT_LIVE/);
  });

  it("renders app browser live with url bar and warm endpoint", () => {
    const html = renderEmbedAppBrowserLiveHtml();
    assert.match(html, /\/api\/browser\/live-stream/);
    assert.match(html, /urlInput/);
    assert.match(html, /\/api\/browser\/warm/);
    assert.match(html, /\/api\/browser\/navigate/);
  });
});
