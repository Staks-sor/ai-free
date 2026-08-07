import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createQwenIncrementalParser,
  formatQwenStreamDisplay,
  parseQwenResponseText,
} from "../src/providers/qwen/client.mjs";

describe("qwen incremental parser", () => {
  it("formatQwenStreamDisplay combines thinking and answer", () => {
    const text = formatQwenStreamDisplay("думаю", "ответ");
    assert.match(text, /🧠 думаю/);
    assert.match(text, /ответ/);
  });

  it("streams answer chunks incrementally", () => {
    const chunks = [];
    const parser = createQwenIncrementalParser({
      onText: (chunk) => chunks.push(chunk),
    });
    parser.push('data: {"content":"Hel"}\n\n');
    parser.push('data: {"content":"lo"}\n\n');
    parser.push("data: [DONE]\n\n");
    const result = parser.finish();
    assert.deepEqual(chunks, ["Hel", "lo"]);
    assert.equal(result.text, "Hello");
  });

  it("reports whether a raw chunk produced useful assistant text", () => {
    const parser = createQwenIncrementalParser();

    assert.equal(
      parser.push('data: {"response.created":{"response_id":"primary","response_index":0}}\n\n'),
      false,
    );
    assert.equal(
      parser.push('data: {"choices":[{"delta":{"content":"Hello"}}],"response_id":"primary"}\n\n'),
      true,
    );
  });

  it("separates thinking from answer", () => {
    const thinking = [];
    const answer = [];
    const parser = createQwenIncrementalParser({
      onThinking: (chunk) => thinking.push(chunk),
      onText: (chunk) => answer.push(chunk),
    });
    parser.push('data: {"phase":"think","content":"hmm"}\n\n');
    parser.push('data: {"content":"ok"}\n\n');
    const result = parser.finish();
    assert.deepEqual(thinking, ["hmm"]);
    assert.deepEqual(answer, ["ok"]);
    assert.equal(result.thinkingText, "hmm");
    assert.equal(result.text, "ok");
  });

  it("keeps response_index 0 when Qwen interleaves two responses", () => {
    const chunks = [];
    const parser = createQwenIncrementalParser({ onText: (chunk) => chunks.push(chunk) });
    parser.push('data: {"response.created":{"response_id":"alternate","response_index":1}}\n\n');
    parser.push('data: {"response.created":{"response_id":"primary","response_index":0}}\n\n');
    parser.push('data: {"choices":[{"delta":{"content":"Main "}}],"response_id":"primary"}\n\n');
    parser.push('data: {"choices":[{"delta":{"content":"Wrong "}}],"response_id":"alternate"}\n\n');
    parser.push('data: {"choices":[{"delta":{"content":"answer"}}],"response_id":"primary"}\n\n');
    parser.push('data: {"choices":[{"delta":{"content":"branch"}}],"response_id":"alternate"}\n\n');

    const result = parser.finish();
    assert.deepEqual(chunks, ["Main ", "answer"]);
    assert.equal(result.text, "Main answer");
    assert.equal(result.lastMessageId, "primary");
  });

  it("filters interleaved responses in buffered non-streaming parsing", () => {
    const sse = [
      'data: {"response.created":{"response_id":"alternate","response_index":1}}',
      'data: {"response.created":{"response_id":"primary","response_index":0}}',
      'data: {"choices":[{"delta":{"content":"Main "}}],"response_id":"primary"}',
      'data: {"choices":[{"delta":{"content":"Wrong "}}],"response_id":"alternate"}',
      'data: {"choices":[{"delta":{"content":"answer"}}],"response_id":"primary"}',
      'data: {"choices":[{"delta":{"content":"branch"}}],"response_id":"alternate"}',
      "data: [DONE]",
    ].join("\n\n");

    const result = parseQwenResponseText(sse, "text/event-stream");
    assert.equal(result.text, "Main answer");
    assert.equal(result.lastMessageId, "primary");
  });
});
