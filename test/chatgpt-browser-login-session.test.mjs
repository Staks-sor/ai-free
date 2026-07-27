import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSuccessfulChatGPTSession } from "../src/providers/chatgpt/browser-login.mjs";

describe("ChatGPT login session validation", () => {
  it("rejects a stale session with RefreshAccessTokenError", () => {
    assert.equal(isSuccessfulChatGPTSession({
      user: { id: "user" },
      accessToken: "stale-token",
      sessionToken: "stale-session",
      error: "RefreshAccessTokenError",
    }), false);
  });

  it("accepts a fully refreshed authenticated session", () => {
    assert.equal(isSuccessfulChatGPTSession({
      user: { id: "user" },
      accessToken: "active-token",
      sessionToken: "active-session",
    }), true);
  });
});
