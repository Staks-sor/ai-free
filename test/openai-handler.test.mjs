import { Readable, Writable } from "node:stream";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  buildPromptFromChatBody,
  handleQwenStream,
  handleRequest,
  requestSearchEnabled,
  StreamParser,
  toAnthropicMessageResponse,
  toolsForModelPrompt,
} from "../api/openai-handler.mjs";

describe("OpenAI-compatible handler", () => {
  it("advertises the Responses API endpoint", async () => {
    const res = await callHandler({ method: "GET", url: "/" });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json.endpoints.includes("POST /v1/responses"));
  });

  it("validates /v1/responses before calling upstream providers", async () => {
    const res = await callHandler({
      method: "POST",
      url: "/v1/responses",
      body: { model: "qwen3.7-max" },
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.json.error.message, /input/i);
  });

  it("rejects unknown /v1/responses models", async () => {
    const res = await callHandler({
      method: "POST",
      url: "/v1/responses",
      body: { model: "not-a-model", input: "hello" },
    });
    assert.equal(res.statusCode, 404);
    assert.match(res.json.error.message, /Unknown model/);
  });

  it("advertises and validates the Anthropic-compatible Messages endpoint", async () => {
    const root = await callHandler({ method: "GET", url: "/" });
    assert.ok(root.json.endpoints.includes("POST /v1/messages"));

    const missingMessages = await callHandler({
      method: "POST",
      url: "/v1/messages",
      body: { model: "deepseek-chat", max_tokens: 128 },
    });
    assert.equal(missingMessages.statusCode, 400);
    assert.equal(missingMessages.json.type, "error");
    assert.match(missingMessages.json.error.message, /messages/i);
  });

  it("maps parsed tool calls to Anthropic tool_use content", () => {
    const response = toAnthropicMessageResponse("deepseek-chat", '```tool_calls\n[{"name":"create_reminder","arguments":{"text":"test","at":"2026-06-15T09:00:00+03:00"}}]\n```');
    assert.equal(response.type, "message");
    assert.equal(response.stop_reason, "tool_use");
    assert.equal(response.content[0].type, "tool_use");
    assert.equal(response.content[0].name, "create_reminder");
    assert.deepEqual(response.content[0].input, {
      text: "test",
      at: "2026-06-15T09:00:00+03:00",
    });
  });

  it("treats OpenAI and Anthropic web-search options as native provider search", () => {
    assert.equal(requestSearchEnabled({ search: true }), true);
    assert.equal(requestSearchEnabled({ web_search_options: {} }), true);
    assert.equal(requestSearchEnabled({ tools: [{ type: "web_search_20250305", name: "web_search" }] }), true);
    assert.deepEqual(
      toolsForModelPrompt([
        { type: "web_search_20250305", name: "web_search" },
        { type: "function", function: { name: "create_reminder" } },
      ]),
      [{ type: "function", function: { name: "create_reminder" } }],
    );
  });

  it("terminates streaming tool calls with finish_reason=tool_calls", () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("deepseek-chat", res);

    parser.onText("```tool_calls\n");
    parser.onText('[{"name":"create_reminder","arguments":{"text":"test","at":"2026-06-15T09:00:00+03:00"}}]');
    parser.onText("\n```");
    parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    assert.equal(events.at(0).choices[0].delta.role, "assistant");
    assert.equal(events.some((event) => event.choices[0].delta.tool_calls?.[0]?.function?.name === "create_reminder"), true);
    assert.deepEqual(events.at(-1).choices[0], {
      index: 0,
      delta: {},
      finish_reason: "tool_calls",
    });
  });

  it("buffers split XML tool_call chunks and emits OpenAI tool calls", () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.7-max", res);

    parser.onText("Сейчас проверю.\n<tool");
    parser.onText('_call name="read_file">');
    parser.onText('{"path":"src/app.js"}');
    parser.onText("</tool");
    parser.onText("_call>");
    parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    const content = events
      .map((event) => event.choices[0].delta.content || "")
      .join("");

    assert.equal(content, "Сейчас проверю.\n");
    assert.equal(content.includes("<tool"), false);
    assert.equal(events.some((event) => event.choices[0].delta.tool_calls?.[0]?.function?.name === "read_file"), true);
    assert.equal(events.at(-1).choices[0].finish_reason, "tool_calls");
  });

  it("buffers split Qwen function XML chunks and emits OpenAI tool calls", () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.7-max", res);

    parser.onText("<func");
    parser.onText("tion=write_file>");
    parser.onText("<parameter=path>src/app.js</parameter>");
    parser.onText('<parameter=content>{"ok":true}</parameter>');
    parser.onText("</function>");
    parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    const toolCall = events.find((event) => event.choices[0].delta.tool_calls)?.choices[0].delta.tool_calls[0];

    assert.equal(toolCall.function.name, "write_file");
    assert.deepEqual(JSON.parse(toolCall.function.arguments), {
      path: "src/app.js",
      content: { ok: true },
    });
    assert.equal(events.at(-1).choices[0].finish_reason, "tool_calls");
  });

  it("terminates normal streaming text with finish_reason=stop", () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("deepseek-chat", res);

    parser.onText("hello");
    parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    assert.equal(events.at(-1).choices[0].finish_reason, "stop");
  });

  it("does not terminate an empty tool_calls block as a successful tool turn", () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.7-max", res);

    parser.onText("```tool_calls\n[]\n```");
    parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    const content = events.map((event) => event.choices[0].delta.content || "").join("");
    assert.match(content, /tool call|инструмент/i);
    assert.equal(events.some((event) => event.choices[0].delta.tool_calls?.length), false);
    assert.equal(events.at(-1).choices[0].finish_reason, "stop");
  });

  it("never terminates an empty stream without an explanatory content delta", () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("deepseek-v4-pro", res);

    parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    assert.equal(events[0].choices[0].delta.role, "assistant");
    assert.match(
      events.map((event) => event.choices[0].delta.content || "").join(""),
      /empty|without response|пуст/i,
    );
    assert.equal(events.at(-1).choices[0].finish_reason, "stop");
  });

  it("retries an empty Qwen stream in a fresh chat before closing OpenAI SSE", async () => {
    const res = makeWritableResponse();
    const chatIds = [];
    let attempts = 0;
    const client = {
      async complete({ chatId, onText }) {
        attempts += 1;
        chatIds.push(chatId);
        if (attempts === 1) {
          return { text: "Qwen returned service events only", lastMessageId: null };
        }
        onText("working response");
        return { text: "working response", lastMessageId: "response-2" };
      },
    };
    let chatNumber = 0;

    await handleQwenStream(client, null, "hello", "qwen3.7-max", "qwen3.7-max", res, {
      createChat: async () => `chat-${++chatNumber}`,
    });

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    const content = events.map((event) => event.choices[0].delta.content || "").join("");
    assert.equal(attempts, 2);
    assert.deepEqual(chatIds, ["chat-1", "chat-2"]);
    assert.equal(content, "working response");
    assert.equal(events.at(-1).choices[0].finish_reason, "stop");
  });

  it("retries a Qwen first-content timeout in a fresh chat without refreshing auth", async () => {
    const res = makeWritableResponse();
    const chatIds = [];
    let attempts = 0;
    let refreshes = 0;
    const client = {
      async complete({ chatId, onText }) {
        attempts += 1;
        chatIds.push(chatId);
        if (attempts === 1) {
          const error = new Error("Qwen stream produced no response content before timeout.");
          error.code = "EMPTY_UPSTREAM_STREAM";
          throw error;
        }
        onText("recovered response");
        return { text: "recovered response", lastMessageId: "response-2" };
      },
    };
    let chatNumber = 0;

    await handleQwenStream(client, null, "hello", "qwen3.7-plus", "qwen3.7-plus", res, {
      createChat: async () => `chat-${++chatNumber}`,
      refreshClient: async () => {
        refreshes += 1;
        return client;
      },
    });

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    const content = events.map((event) => event.choices[0].delta.content || "").join("");
    assert.equal(attempts, 2);
    assert.equal(refreshes, 0);
    assert.deepEqual(chatIds, ["chat-1", "chat-2"]);
    assert.equal(content, "recovered response");
    assert.equal(events.at(-1).choices[0].finish_reason, "stop");
  });

  it("maps tool result ids back to tool names and explains validation recovery", () => {
    const prompt = buildPromptFromChatBody({
      tools: [{
        type: "function",
        function: {
          name: "Edit",
          parameters: {
            type: "object",
            properties: { file_path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } },
            required: ["file_path", "old_string", "new_string"],
          },
        },
      }],
      messages: [
        { role: "assistant", content: "", tool_calls: [{ id: "call_1", function: { name: "Edit", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_1", content: "params must have required property 'new_string'" },
        { role: "tool", tool_call_id: "call_2", content: "No changes detected." },
      ],
    }, "deepseek-v4-pro", { provider: "deepseek", model: "expert" });

    assert.match(prompt, /TOOL RESULT FOR Edit/);
    assert.match(prompt, /missing required argument/i);
    assert.match(prompt, /No changes detected/i);
  });
});

async function callHandler({ method, url, body }) {
  const res = makeWritableResponse();
  const reqBody = body === undefined ? "" : JSON.stringify(body);
  const req = Readable.from(reqBody ? [Buffer.from(reqBody)] : []);
  req.method = method;
  req.url = url;
  req.headers = { host: "127.0.0.1:4318" };

  await handleRequest(req, res);
  const text = Buffer.concat(res.chunks).toString("utf8");
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    text,
    json: text ? JSON.parse(text) : null,
  };
}

function makeWritableResponse() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  res.statusCode = 200;
  res.headers = {};
  res.chunks = chunks;
  res.setHeader = (name, value) => {
    res.headers[String(name).toLowerCase()] = value;
  };
  return res;
}

function parseSseJsonEvents(text) {
  return text
    .split("\n\n")
    .map((event) => event.trim())
    .filter((event) => event.startsWith("data: "))
    .map((event) => event.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
}
