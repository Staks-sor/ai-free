import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChatGPTChatClient } from "../src/providers/chatgpt/client.mjs";

describe("ChatGPTChatClient web auth", () => {
  it("does not require a short-lived access token before using the browser session", async () => {
    let calls = 0;
    let receivedModel = null;
    const client = new ChatGPTChatClient({
      accessToken: "",
      cookies: [{ name: "__Secure-next-auth.session-token", value: "session" }],
      proxyFactory: async () => ({
        sendChat: async ({ prompt, model }) => {
          calls += 1;
          receivedModel = model;
          return { text: `reply:${prompt}`, conversationId: null, lastMessageId: null, images: [] };
        },
      }),
    });

    const result = await client.complete({ prompt: "test", model: "gpt-5.6-sol-high" });
    assert.equal(result.text, "reply:test");
    assert.equal(calls, 1);
    assert.equal(receivedModel, "gpt-5.6-sol-high");
  });
});
