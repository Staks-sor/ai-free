// Тесты парсера SSE — самой хрупкой части протокола. Если DeepSeek поменяет
// формат событий, эти тесты упадут первыми. Это намеренный canary.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { extractDeltaText, parseSseEvent, streamSse } from "../src/providers/deepseek/sse.mjs";

describe("parseSseEvent", () => {
  it("parses standard event:/data: pair", () => {
    const raw = 'event: message\ndata: {"v":"hi"}';
    assert.deepEqual(parseSseEvent(raw), {
      event: "message",
      data: '{"v":"hi"}',
    });
  });

  it("concatenates multi-line data:", () => {
    const raw = "data: line1\ndata: line2";
    assert.equal(parseSseEvent(raw).data, "line1\nline2");
  });

  it("handles CRLF", () => {
    const raw = 'event: x\r\ndata: {"a":1}';
    assert.equal(parseSseEvent(raw).event, "x");
    assert.equal(parseSseEvent(raw).data, '{"a":1}');
  });

  it("returns empty when no data:", () => {
    assert.equal(parseSseEvent("event: ping").data, "");
  });
});

describe("extractDeltaText", () => {
  it("extracts plain {v: ...} delta", () => {
    const cache = new Map();
    const { text } = extractDeltaText({ v: "hello" }, cache);
    assert.equal(text, "hello");
  });

  it("extracts APPEND op with /content path", () => {
    const cache = new Map();
    const { text } = extractDeltaText(
      { o: "APPEND", p: "/messages/0/content", v: " world" },
      cache,
    );
    assert.equal(text, " world");
  });

  it("handles BATCH op with array of APPEND deltas", () => {
    const cache = new Map();
    const { text } = extractDeltaText(
      {
        o: "BATCH",
        v: [
          { o: "APPEND", p: "/m/content", v: "a" },
          { o: "APPEND", p: "/x/content", v: "b" },
        ],
      },
      cache,
    );
    assert.equal(text, "ab");
  });

  it("handles OpenAI-compat delta.content", () => {
    const cache = new Map();
    const { text } = extractDeltaText(
      { choices: [{ delta: { content: "compat" } }] },
      cache,
    );
    assert.equal(text, "compat");
  });

  it("extracts response_message_id when present", () => {
    const cache = new Map();
    const { messageId } = extractDeltaText({ response_message_id: 42, v: "x" }, cache);
    assert.equal(messageId, 42);
  });

  it("extracts message_id when present", () => {
    const cache = new Map();
    const { messageId } = extractDeltaText({ message_id: 7, v: "x" }, cache);
    assert.equal(messageId, 7);
  });

  it("returns empty text for unrecognized shapes", () => {
    const cache = new Map();
    const { text, messageId } = extractDeltaText({ random: "junk" }, cache);
    assert.equal(text, "");
    assert.equal(messageId, null);
  });

  it("accumulates deltas via cache for cumulative RESPONSE bodies", () => {
    const cache = new Map();
    const first = extractDeltaText(
      { type: "RESPONSE", content: "hello", id: 1, role: "ASSISTANT" },
      cache,
    );
    const second = extractDeltaText(
      { type: "RESPONSE", content: "hello world", id: 1, role: "ASSISTANT" },
      cache,
    );
    assert.equal(first.text, "hello");
    // На втором проходе вычитаем уже виденное — должен прийти только новый кусок.
    assert.equal(second.text, " world");
  });
});

describe("streamSse", () => {
  it("processes the final SSE event even without a trailing blank line", async () => {
    const response = new Response('data: {"v":"tail"}');
    const result = await streamSse(response, false);
    assert.equal(result.text, "tail");
  });

  it("processes CRLF-separated SSE frames", async () => {
    const response = new Response('data: {"v":"one"}\r\n\r\ndata: {"v":" two"}\r\n\r\n');
    const result = await streamSse(response, false);
    assert.equal(result.text, "one two");
  });

  it("rejects an upstream stream that contains no usable response", async () => {
    const response = new Response('event: ping\ndata: {"status":"ok"}\n\n');
    await assert.rejects(
      () => streamSse(response, false),
      /ended without response content/i,
    );
  });
});
