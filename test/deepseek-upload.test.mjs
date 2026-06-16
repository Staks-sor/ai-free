import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  formatDeepSeekFileFailure,
  isDeepSeekFileFailedStatus,
  isDeepSeekFileReadyStatus,
} from "../src/providers/deepseek/client.mjs";

describe("isDeepSeekFileReadyStatus", () => {
  it("treats PARSING as not ready", () => {
    assert.equal(isDeepSeekFileReadyStatus("PARSING"), false);
    assert.equal(isDeepSeekFileReadyStatus("parsing"), false);
  });

  it("treats PENDING as not ready", () => {
    assert.equal(isDeepSeekFileReadyStatus("PENDING"), false);
  });

  it("treats SUCCESS as ready", () => {
    assert.equal(isDeepSeekFileReadyStatus("SUCCESS"), true);
    assert.equal(isDeepSeekFileReadyStatus("READY"), true);
  });

  it("treats empty as not ready", () => {
    assert.equal(isDeepSeekFileReadyStatus(""), false);
    assert.equal(isDeepSeekFileReadyStatus(null), false);
  });
});

describe("isDeepSeekFileFailedStatus", () => {
  it("treats CONTENT_EMPTY as terminal failure", () => {
    assert.equal(isDeepSeekFileFailedStatus("CONTENT_EMPTY"), true);
    assert.equal(isDeepSeekFileReadyStatus("CONTENT_EMPTY"), false);
  });

  it("formats CONTENT_EMPTY message for user", () => {
    const msg = formatDeepSeekFileFailure(
      { status: "CONTENT_EMPTY", file_name: "test.png" },
      "file-abc",
    );
    assert.match(msg, /CONTENT_EMPTY/);
    assert.match(msg, /test\.png/);
  });
});
