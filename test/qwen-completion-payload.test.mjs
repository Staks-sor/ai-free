import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildQwenCompletionPayload } from "../src/providers/qwen/completion-payload.mjs";

describe("qwen completion payload", () => {
  it("matches the current Qwen web payload envelope", () => {
    const body = buildQwenCompletionPayload({
      chatId: "chat-1",
      prompt: "hi",
      model: "qwen3.7-plus",
      thinking: false,
      search: false,
    });
    assert.equal(body.version, "2.1");
    assert.equal(body.timestamp, body.messages[0].timestamp);
    assert.equal(body.messages[0].childrenIds.length, 1);
    assert.match(body.messages[0].childrenIds[0], /^[0-9a-f-]{36}$/);
    assert.equal(body.messages[0].feature_config.auto_search, false);
    assert.equal(body.messages[0].feature_config.thinking_enabled, false);
    assert.deepEqual(body.messages[0].extra, { meta: { subChatType: "t2t" } });
  });
});
