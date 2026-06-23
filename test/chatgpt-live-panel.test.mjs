import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHATGPT_PANEL_VIEWPORT,
  renderEmbedChatGPTLiveHtml,
} from "../src/window-app/chatgpt-live-panel.mjs";

describe("chatgpt-live-panel", () => {
  it("exports viewport constants", () => {
    assert.equal(CHATGPT_PANEL_VIEWPORT.width, 580);
    assert.equal(CHATGPT_PANEL_VIEWPORT.height, 900);
  });

  it("renders live embed html with stream and sync endpoints", () => {
    const html = renderEmbedChatGPTLiveHtml();
    assert.match(html, /\/api\/chatgpt\/live-stream/);
    assert.match(html, /\/api\/chatgpt\/sync-session/);
    assert.match(html, /\/api\/chatgpt\/live-input/);
    assert.match(html, /\/api\/chatgpt\/reload-live/);
    assert.match(html, /\/api\/chatgpt\/reset-live/);
    assert.match(html, /resetBtn/);
    assert.match(html, /clickLayer/);
  });
});
