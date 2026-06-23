import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rewriteChatGPTFrameBodyForTest } from "../src/window-app/provider-frame-chatgpt.mjs";

describe("rewriteChatGPTFrameBody", () => {
  it("rewrites root-relative asset paths in HTML", () => {
    const html = '<html><head></head><body><link rel="stylesheet" href="/_next/static/css/app.css"></body></html>';
    const out = rewriteChatGPTFrameBodyForTest(html, "text/html").toString("utf8");
    assert.match(out, /<base href="\/provider-frame\/chatgpt\/">/);
    assert.match(out, /href="\/provider-frame\/chatgpt\/_next\/static\/css\/app.css"/);
  });

  it("rewrites root-relative urls in CSS", () => {
    const css = ".x { background: url(/cdn/assets/bg.png); }";
    const out = rewriteChatGPTFrameBodyForTest(css, "text/css").toString("utf8");
    assert.match(out, /url\(\/provider-frame\/chatgpt\/cdn\/assets\/bg.png\)/);
  });
});
