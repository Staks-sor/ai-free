import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IN_APP_BROWSER_PROFILE,
  IN_APP_BROWSER_VIEWPORT,
  getInAppBrowserLaunchLabel,
} from "../src/window-app/in-app-browser.mjs";
import { CHATGPT_BROWSER_PROFILE } from "../src/providers/chatgpt/config.mjs";

describe("in-app-browser", () => {
  it("shares profile with ChatGPT browser for persistent session", () => {
    assert.equal(IN_APP_BROWSER_PROFILE, CHATGPT_BROWSER_PROFILE);
  });

  it("uses panel-sized viewport for MJPEG stream", () => {
    assert.equal(IN_APP_BROWSER_VIEWPORT.width, 580);
    assert.equal(IN_APP_BROWSER_VIEWPORT.height, 900);
  });

  it("defaults to google-chrome-cdp launch label", () => {
    assert.equal(getInAppBrowserLaunchLabel(), "google-chrome-cdp");
  });
});
