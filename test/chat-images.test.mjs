import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import {
  deleteConversationImages,
  persistChatImages,
  resolveChatImage,
} from "../src/window-app/chat-images.mjs";

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
