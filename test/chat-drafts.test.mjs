import assert from "node:assert/strict";
import { test } from "node:test";
import { createChatDraftStore } from "../src/window-app/chat-drafts.mjs";

test("drafts and in-flight sends are isolated by conversation", () => {
  const drafts = createChatDraftStore();
  drafts.set("chat-a", "unfinished A");
  drafts.set("chat-b", "unfinished B");
  drafts.startSend("chat-a");
  assert.equal(drafts.get("chat-a"), "unfinished A");
  assert.equal(drafts.get("chat-b"), "unfinished B");
  assert.equal(drafts.isSending("chat-a"), true);
  assert.equal(drafts.isSending("chat-b"), false);
  drafts.clear("chat-a");
  drafts.finishSend("chat-a");
  assert.equal(drafts.get("chat-a"), "");
  assert.equal(drafts.get("chat-b"), "unfinished B");
});
