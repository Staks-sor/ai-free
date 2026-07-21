import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EconomyOSClient } from "../src/providers/economyos/client.mjs";
import { createNativeCodeSystemPrompt } from "../src/code-agent/native-tools.mjs";

describe("EconomyOS client", () => {
  it("loads the authenticated EconomyOS model catalog", async () => {
    const requests = [];
    const client = new EconomyOSClient({
      apiKey: "user-owned-key",
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return new Response(JSON.stringify({
          data: [{ id: "z-ai-glm-4-7-flash", name: "GLM 4.7 Flash" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    const models = await client.listModels();
    assert.equal(requests[0].url, "https://compute.virtuals.io/v1/models");
    assert.equal(requests[0].options.headers.Authorization, "Bearer user-owned-key");
    assert.equal(models[0].id, "z-ai-glm-4-7-flash");
  });

  it("uses the official Virtuals endpoint and the user's Bearer key", async () => {
    let captured;
    const client = new EconomyOSClient({
      apiKey: "user-owned-key",
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return new Response(JSON.stringify({
          choices: [{ message: { content: "hello" } }],
        }), { headers: { "content-type": "application/json" } });
      },
    });

    const result = await client.complete({ prompt: "Hi", model: "test/model" });

    assert.equal(captured.url, "https://compute.virtuals.io/v1/chat/completions");
    assert.equal(captured.options.headers.Authorization, "Bearer user-owned-key");
    assert.equal(JSON.parse(captured.options.body).model, "test/model");
    assert.equal(result.text, "hello");
  });

  it("streams OpenAI-compatible SSE text incrementally", async () => {
    const chunks = [];
    const body = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const client = new EconomyOSClient({
      apiKey: "user-owned-key",
      fetchImpl: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
    });

    const result = await client.complete({ prompt: "Hi", onText: (chunk) => chunks.push(chunk) });

    assert.deepEqual(chunks, ["Hel", "lo"]);
    assert.equal(result.text, "Hello");
  });

  it("never puts the API key in the request body", async () => {
    let requestBody = "";
    const client = new EconomyOSClient({
      apiKey: "secret-user-key",
      fetchImpl: async (_url, options) => {
        requestBody = String(options.body || "");
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          headers: { "content-type": "application/json" },
        });
      },
    });

    await client.complete({ prompt: "Hi" });
    assert.doesNotMatch(requestBody, /secret-user-key/);
  });

  it("sends images directly to EconomyOS as OpenAI-compatible image content", async () => {
    let requestBody;
    const client = new EconomyOSClient({
      apiKey: "user-owned-key",
      fetchImpl: async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return new Response(JSON.stringify({ choices: [{ message: { content: "seen" } }] }), {
          headers: { "content-type": "application/json" },
        });
      },
    });

    await client.complete({
      prompt: "What is shown?",
      images: [{ mimeType: "image/png", dataBase64: "aW1hZ2U=" }],
    });

    assert.equal(requestBody.messages[0].content[0].type, "text");
    assert.equal(requestBody.messages[0].content[1].type, "image_url");
    assert.equal(requestBody.messages[0].content[1].image_url.url, "data:image/png;base64,aW1hZ2U=");
  });

  it("retries a terminated transport before any response text is emitted", async () => {
    let attempts = 0;
    const client = new EconomyOSClient({
      apiKey: "user-owned-key",
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError("terminated");
        return new Response(JSON.stringify({ choices: [{ message: { content: "recovered" } }] }), {
          headers: { "content-type": "application/json" },
        });
      },
    });

    const result = await client.complete({ prompt: "Continue" });
    assert.equal(attempts, 2);
    assert.equal(result.text, "recovered");
  });

  it("backs off rate limits without retrying forever", async () => {
    let attempts = 0;
    const client = new EconomyOSClient({
      apiKey: "user-owned-key",
      nativeRequestIntervalMs: 0,
      fetchImpl: async () => {
        attempts += 1;
        return new Response(JSON.stringify({ error: { message: "Rate limit exceeded" } }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "0" },
        });
      },
    });

    await assert.rejects(
      () => client.complete({
        prompt: "Continue",
        tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }],
      }),
      (error) => error.code === "ECONOMYOS_TEMPORARILY_UNAVAILABLE" && error.status === 429,
    );
    assert.equal(attempts, 3);
  });


  it("stops temporary HTTP retries at the checkpoint boundary", async () => {
    let attempts = 0;
    const client = new EconomyOSClient({
      apiKey: "user-owned-key",
      nativeRequestIntervalMs: 0,
      fetchImpl: async () => {
        attempts += 1;
        return new Response("", { status: 503, headers: { "retry-after": "0" } });
      },
    });

    await assert.rejects(
      () => client.complete({
        prompt: "Continue code task",
        tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }],
      }),
      (error) => error.code === "ECONOMYOS_TEMPORARILY_UNAVAILABLE",
    );
    assert.equal(attempts, 3);
  });

  it("retries temporary HTTP failures for native code requests", async () => {
    let attempts = 0;
    const client = new EconomyOSClient({
      apiKey: "user-owned-key",
      nativeRequestIntervalMs: 0,
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) return new Response("", { status: 503, headers: { "retry-after": "0" } });
        return new Response(JSON.stringify({ choices: [{ message: { content: "recovered" } }] }), {
          headers: { "content-type": "application/json" },
        });
      },
    });

    const result = await client.complete({
      prompt: "Continue code task",
      tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }],
    });
    assert.equal(attempts, 2);
    assert.equal(result.text, "recovered");
  });

  it("uses native API tool calls and returns results with role tool", async () => {
    const bodies = [];
    let request = 0;
    const client = new EconomyOSClient({
      apiKey: "user-owned-key",
      nativeRequestIntervalMs: 0,
      fetchImpl: async (_url, options) => {
        bodies.push(JSON.parse(options.body));
        request += 1;
        const message = request === 1
          ? {
              content: null,
              tool_calls: [{
                id: "call_1",
                type: "function",
                function: { name: "read_file", arguments: '{"path":"README.md"}' },
              }],
            }
          : { content: "Done", tool_calls: [] };
        return new Response(JSON.stringify({ choices: [{ message }] }), {
          headers: { "content-type": "application/json" },
        });
      },
    });
    const sessionId = await client.createSession();
    const first = await client.complete({
      sessionId,
      prompt: "Inspect the project",
      systemPrompt: "You are a coding agent.",
      tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }],
    });
    assert.deepEqual(first.toolCall, { id: "call_1", name: "read_file", arguments: { path: "README.md" } });
    assert.equal(bodies[0].parallel_tool_calls, false);
    assert.equal(bodies[0].stream, false);

    const second = await client.complete({
      sessionId,
      prompt: "",
      systemPrompt: "You are a coding agent.",
      tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }],
      toolResult: { toolCallId: "call_1", result: { ok: true, content: "AI Free" } },
    });
    assert.equal(second.text, "Done");
    assert.deepEqual(bodies[1].messages.map((message) => message.role), ["system", "user", "assistant", "tool"]);
    assert.equal(bodies[1].messages[3].tool_call_id, "call_1");
  });

  it("exports and restores a native agent session checkpoint", async () => {
    const client = new EconomyOSClient({ apiKey: "key", fetchImpl: async () => new Response("{}") });
    const sessionId = await client.createSession();
    client.sessions.set(sessionId, [{ role: "user", content: "Inspect project" }]);
    const exported = client.exportSession(sessionId);

    const restored = new EconomyOSClient({ apiKey: "key", fetchImpl: async () => new Response("{}") });
    restored.restoreSession(sessionId, exported);
    assert.equal(restored.hasSession(sessionId), true);
    assert.deepEqual(restored.exportSession(sessionId), exported);
  });

  it("compacts old tool output while preserving recent tool results", async () => {
    let requestBody;
    const client = new EconomyOSClient({
      apiKey: "user-owned-key",
      fetchImpl: async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return new Response(JSON.stringify({ choices: [{ message: { content: "Done" } }] }), {
          headers: { "content-type": "application/json" },
        });
      },
    });
    const sessionId = await client.createSession();
    const history = [{ role: "system", content: "Agent" }, { role: "user", content: "Work" }];
    for (let index = 0; index < 8; index += 1) {
      history.push({
        role: "assistant",
        content: null,
        tool_calls: [{ id: `call_${index}`, type: "function", function: { name: "read_file", arguments: "{}" } }],
      });
      history.push({ role: "tool", tool_call_id: `call_${index}`, content: "x".repeat(16000) });
    }
    client.sessions.set(sessionId, history);

    await client.complete({
      sessionId,
      tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }],
    });

    const toolMessages = requestBody.messages.filter((message) => message.role === "tool");
    assert.match(toolMessages[0].content, /older tool result truncated/);
    assert.equal(toolMessages.at(-1).content.length, 14030);
  });

  it("includes the recent chat conversation in the native agent prompt", () => {
    const prompt = createNativeCodeSystemPrompt("/workspace", {
      conversationContext: "User: Fix the provider\n\nAssistant: I found the transport issue.",
    });

    assert.match(prompt, /User: Fix the provider/);
    assert.match(prompt, /Assistant: I found the transport issue/);
    assert.match(prompt, /Recent conversation:/);
    assert.match(prompt, /Minimize API turns: batch related read-only file inspections/);
  });

  it("labels compressed memory separately from the live conversation", () => {
    const prompt = createNativeCodeSystemPrompt("/workspace", {
      conversationContext: "User: Continue the previous task.",
      memoryContext: "- [fix] Provider tool turns use JSON responses.",
    });

    assert.match(prompt, /Recent conversation:\nUser: Continue/);
    assert.match(prompt, /Relevant long-term memory \(compressed\):\n- \[fix\]/);
  });
  it("serializes simultaneous completions instead of sending a rate-limit burst", async () => {
    const started = [];
    const client = new EconomyOSClient({
      apiKey: "user-owned-key",
      nativeRequestIntervalMs: 25,
      fetchImpl: async () => {
        started.push(Date.now());
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          headers: { "content-type": "application/json" },
        });
      },
    });

    await Promise.all([
      client.complete({ prompt: "one" }),
      client.complete({ prompt: "two" }),
      client.complete({ prompt: "three" }),
    ]);

    assert.equal(started.length, 3);
    assert.ok(started[1] - started[0] >= 15, `second request gap was ${started[1] - started[0]}ms`);
    assert.ok(started[2] - started[1] >= 15, `third request gap was ${started[2] - started[1]}ms`);
  });

});
