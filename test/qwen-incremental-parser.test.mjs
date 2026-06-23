import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createQwenIncrementalParser,
  formatQwenStreamDisplay,
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
});
