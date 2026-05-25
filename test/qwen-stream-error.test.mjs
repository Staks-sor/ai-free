import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatQwenStreamError, formatQwenUserFacingError } from "../src/providers/qwen/client.mjs";

describe("Qwen SSE error parsing", () => {
  it("formats quota exceeded from error event", () => {
    const payload = {
      error: {
        code: "internal_error",
        details:
          "Allocated quota exceeded, please increase your quota limit. For details, see: https://help.aliyun.com/zh/model-studio/error-code#token-limit",
      },
      response_id: "5c6bdec0-723a-4068-bca8-2719ee04bdbd",
      response_index: 0,
    };
    const msg = formatQwenStreamError(payload);
    assert.ok(msg);
    assert.match(msg, /Лимит Qwen/i);
    assert.match(msg, /quota exceeded/i);
    assert.match(msg, /internal_error/);
  });

  it("returns null when no error field", () => {
    assert.equal(formatQwenStreamError({ "response.created": { chat_id: "x" } }), null);
  });

  it("formatQwenUserFacingError handles rate limit", () => {
    const msg = formatQwenUserFacingError("rate_limit", "Too many requests");
    assert.match(msg, /много запросов/i);
  });
});
