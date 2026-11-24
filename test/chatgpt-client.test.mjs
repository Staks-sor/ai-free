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

  it("does not resend a prompt after a browser failure that may follow submission", async () => {
    let sends = 0;
    const client = new ChatGPTChatClient({
      proxyFactory: async () => ({
        sendChat: async () => {
          sends += 1;
          const error = new Error("Execution context was destroyed");
          error.promptSubmitted = true;
          throw error;
        },
      }),
    });

    await assert.rejects(client.complete({ prompt: "once" }), /Execution context was destroyed/);
    assert.equal(sends, 1);
  });

  it("recovers once when the browser failed before submission", async () => {
    let sends = 0;
    const client = new ChatGPTChatClient({
      proxyFactory: async () => ({
        sendChat: async () => {
          sends += 1;
          if (sends === 1) throw Object.assign(new Error("Execution context was destroyed"), { delivery: "not_sent" });
          return { text: "recovered", conversationId: null, lastMessageId: null, images: [] };
        },
      }),
    });

    const result = await client.complete({ prompt: "retry-safe" });
    assert.equal(result.text, "recovered");
    assert.equal(sends, 2);
  });
});

describe('ChatGPT cancellation and confirmed delivery', () => {
  it('does not initialize or send after Stop', async () => {
    let factories = 0;
    const client = new ChatGPTChatClient({ proxyFactory: async () => { factories++; return { sendChat: async () => ({text:'unexpected'}) }; } });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(client.complete({prompt:'cancelled',signal:controller.signal}), {name:'AbortError'});
    assert.equal(factories,0);
  });
  it('forwards cancellation to the actual browser send', async () => {
    const controller = new AbortController(); let received;
    const client = new ChatGPTChatClient({proxyFactory:async()=>({sendChat:async({signal})=>{received=signal; return {text:'ok'};}})});
    await client.complete({prompt:'test',signal:controller.signal});
    assert.equal(received,controller.signal);
  });
  it('does not resend an unclassified transport failure', async () => {
    let sends=0;
    const client=new ChatGPTChatClient({proxyFactory:async()=>({sendChat:async()=>{sends++;throw new Error('Execution context was destroyed');}})});
    await assert.rejects(client.complete({prompt:'once'}),/Execution context/);
    assert.equal(sends,1);
  });
  it('checks Stop again after browser preparation', async () => {
    const controller=new AbortController();let sends=0;
    const client=new ChatGPTChatClient({proxyFactory:async()=>{controller.abort();return {sendChat:async()=>{sends++;return {text:'unexpected'};}};}});
    await assert.rejects(client.complete({prompt:'once',signal:controller.signal}),{name:'AbortError'});
    assert.equal(sends,0);
  });
});
