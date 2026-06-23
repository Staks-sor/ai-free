import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  DeepSeekChatClient,
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

describe("DeepSeek invalid message id recovery", () => {
  it("detects biz_code 26 invalid message id errors", () => {
    const error = new Error(
      'Completion rejected: biz_code 26, invalid message id: {"data":{"biz_code":26,"biz_msg":"invalid message id"}}',
    );
    assert.equal(DeepSeekChatClient._isInvalidMessageIdError(error), true);
  });

  it("retries once without parentMessageId when DeepSeek rejects an old parent id", async () => {
    const calls = [];
    const client = Object.create(DeepSeekChatClient.prototype);
    client._completeOnce = async (args) => {
      calls.push(args.parentMessageId ?? null);
      if (calls.length === 1) {
        throw new Error("Completion rejected: biz_code 26, invalid message id");
      }
      return { text: "ok", lastAssistantMessageId: 123 };
    };

    const result = await client._completeWithInvalidMessageRetry(
      { sessionId: "s", prompt: "p", parentMessageId: 42 },
      [],
    );

    assert.deepEqual(calls, [42, null]);
    assert.equal(result.text, "ok");
    assert.equal(result.lastAssistantMessageId, 123);
  });
});
