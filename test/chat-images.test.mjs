import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import {
  deleteConversationImages,
  persistChatImages,
  resolveChatImage,
} from "../src/window-app/chat-images.mjs";
import * as chatImages from '../src/window-app/chat-images.mjs';

it('a Qwen retry restores only images belonging to the same saved conversation', () => {
  const id = randomUUID();
  try {
    const [saved] = persistChatImages(id, [{ name: 'image.png', mimeType: 'image/png', dataBase64: 'AQ==' }]);
    assert.equal(typeof chatImages.restoreChatImages, 'function');
    assert.deepEqual(chatImages.restoreChatImages(id, [saved.url]).map(image => image.dataBase64), ['AQ==']);
    assert.throws(() => chatImages.restoreChatImages('another-chat', [saved.url]), /saved chat image/);
    assert.throws(() => chatImages.restoreChatImages(id, ['/etc/passwd']), /saved chat image/);
  } finally { deleteConversationImages(id); }
});

describe("persistent chat images", () => {
  it("stores an image outside state.json and resolves its local chat URL", () => {
    const conversationId = randomUUID();
    try {
      const [saved] = persistChatImages(conversationId, [{
        name: "screen.png",
        mimeType: "image/png",
        dataBase64: Buffer.from("png-content").toString("base64"),
      }]);

      assert.match(saved.url, new RegExp(`^/api/chat-images/${conversationId}/`));
      const resolved = resolveChatImage(saved.url);
      assert.equal(resolved.mimeType, "image/png");
      assert.equal(fs.readFileSync(resolved.file, "utf8"), "png-content");
    } finally {
      deleteConversationImages(conversationId);
    }
  });

  it("rejects traversal paths", () => {
    assert.equal(resolveChatImage("/api/chat-images/../../settings.json"), null);
  });
});
