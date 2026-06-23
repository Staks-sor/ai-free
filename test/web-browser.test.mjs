import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WEB_BROWSER_PROFILE, WEB_BROWSER_DEFAULT_VIEWPORT, getWebBrowserViewport } from "../src/window-app/web-browser.mjs";
import { APP_BROWSER_PROFILE } from "../src/window-app/app-browser.mjs";
import { CHATGPT_BROWSER_PROFILE } from "../src/providers/chatgpt/config.mjs";
import { isToolAllowed } from "../src/skills/permissions.mjs";

describe("web-browser", () => {
  it("uses separate profile from ChatGPT Chrome", () => {
    assert.notEqual(WEB_BROWSER_PROFILE, CHATGPT_BROWSER_PROFILE);
    assert.equal(APP_BROWSER_PROFILE, WEB_BROWSER_PROFILE);
  });

  it("always allows browser tools even with restrictive skill", () => {
    const allowed = ["list_files", "read_file", "write_file"];
    assert.equal(isToolAllowed("browser_snapshot", allowed), true);
    assert.equal(isToolAllowed("browser_navigate", allowed), true);
    assert.equal(isToolAllowed("browser_click", allowed), true);
    assert.equal(isToolAllowed("browser_reset", allowed), true);
    assert.equal(isToolAllowed("run_command", allowed), false);
  });

  it("launch viewport is explicit (Playwright rejects deviceScaleFactor with null viewport)", () => {
    const viewport = getWebBrowserViewport();
    assert.equal(typeof viewport.width, "number");
    assert.equal(typeof viewport.height, "number");
    assert.ok(viewport.width >= WEB_BROWSER_DEFAULT_VIEWPORT.width);
    assert.ok(viewport.height >= WEB_BROWSER_DEFAULT_VIEWPORT.height);
  });
});
