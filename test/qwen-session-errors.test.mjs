import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createQwenSessionExpiredError,
  formatQwenSessionExpiredMessage,
  isQwenAntiBotRejection,
  isQwenSessionExpiredCode,
  isQwenSessionExpiredError,
  isQwenSessionExpiredText,
} from "../src/providers/qwen/session-errors.mjs";
import { isQwenAuthError } from "../src/providers/qwen/auth-manager.mjs";
import { formatQwenUserFacingError } from "../src/providers/qwen/client.mjs";

describe("qwen session errors", () => {
  it("treats Bad_Request internal error as anti-bot, not expired session", () => {
    assert.equal(isQwenSessionExpiredCode("Bad_Request", "Internal error..."), false);
    assert.equal(isQwenAntiBotRejection("Bad_Request", "Internal error..."), true);
    assert.equal(isQwenSessionExpiredCode("Bad_Request", "invalid token"), true);
    assert.equal(isQwenSessionExpiredCode("internal_error", "Произошла непредвиденная ошибка."), false);
    assert.equal(isQwenSessionExpiredCode("internal_error", "token expired"), true);
    assert.equal(isQwenSessionExpiredCode("rate_limit", "Too many requests"), false);
  });

  it("formats relogin instructions for in-app window", () => {
    const msg = formatQwenSessionExpiredMessage({ code: "401", details: "Unauthorized" });
    assert.match(msg, /Сессия Qwen устарела/);
    assert.match(msg, /ai-free откроет окно входа/);
    assert.doesNotMatch(msg, /npm run login-qwen/);
  });

  it("marks session errors as auth errors for auto re-login", () => {
    const err = createQwenSessionExpiredError({ code: "internal_error", details: "x" });
    assert.equal(err.isAuthError, true);
    assert.equal(isQwenSessionExpiredError(err), true);
    assert.equal(isQwenAuthError(err), true);
  });

  it("user-facing formatter shows anti-bot message for Bad_Request", () => {
    const msg = formatQwenUserFacingError("Bad_Request", "Internal error...");
    assert.match(msg, /anti-bot/i);
    assert.doesNotMatch(msg, /Сессия Qwen устарела/);
  });

  it("does not treat generic internal_error assistant text as session expired", () => {
    const text = "Qwen вернул ошибку (internal_error):\n\nПроизошла непредвиденная ошибка.";
    assert.equal(isQwenSessionExpiredText(text), false);
  });
});
