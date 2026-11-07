import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractBareToolCallsArray } from "../api/tool-calls.mjs";

// Degraded Qwen sometimes emits the tool_calls array WITHOUT the ```tool_calls
// fence — bare JSON in prose (observed 2026-08-20: two 3-min completions with
// stream_done and zero "Parsed streaming tool calls" lines). The stream
// detector only triggers on fence markers, so the whole call was streamed to
// the client as plain prose and the agent loop broke.
// Port of FreeQwenApi prePassDeinterleave ideas: find "name"+"arguments"
// objects anywhere in text.

describe("extractBareToolCallsArray", () => {
  it("finds a bare fenced-style JSON array embedded in prose (no fence marker)", () => {
    const prose =
      "Разберёмся с задачей. Сначала прочитаю файл конфигурации.\n" +
      '[\n  {\n    "name": "read_file",\n    "arguments": { "path": "D:/ai-free/package.json" }\n  }\n]\n' +
      "После этого продолжу анализ.";
    const calls = extractBareToolCallsArray(prose);
    assert.ok(calls, "must extract from bare array");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "read_file");
    assert.deepEqual(JSON.parse(calls[0].arguments), { path: "D:/ai-free/package.json" });
  });

  it("finds a single bare object {name, arguments} in prose", () => {
    const prose = 'Хорошо. {"name": "terminal", "arguments": {"command": "ls -la"}} Готово.';
    const calls = extractBareToolCallsArray(prose);
    assert.ok(calls);
    assert.equal(calls[0].name, "terminal");
    assert.deepEqual(JSON.parse(calls[0].arguments), { command: "ls -la" });
  });

  it("handles multiple calls in one bare array", () => {
    const prose = 'Ok. [{"name": "a", "arguments": {}}, {"name": "b", "arguments": {"x": 1}}] done';
    const calls = extractBareToolCallsArray(prose);
    assert.ok(calls);
    assert.equal(calls.length, 2);
  });

  it("ignores plain prose without tool-call structures", () => {
    const prose = "Обычный ответ модели без каких-либо вызовов инструментов. Просто текст с [квадратными скобками] внутри.";
    assert.equal(extractBareToolCallsArray(prose), null);
  });

  it("ignores JSON objects that are not tool calls (no name+arguments)", () => {
    const prose = 'Вот данные: {"users": [{"id": 1}], "total": 5} — конец.';
    assert.equal(extractBareToolCallsArray(prose), null);
  });

  it("requires both name and arguments keys to reduce false positives", () => {
    const prose = 'Ссылка вида {"name": "readme.txt"} — это не вызов инструмента.';
    assert.equal(extractBareToolCallsArray(prose), null);
  });

  it("survives an unterminated (truncated) bare call", () => {
    const prose = 'Начинаю. [\n  {\n    "name": "write_file",\n    "arguments": { "path": "x.txt", "content": "line1';
    const calls = extractBareToolCallsArray(prose);
    assert.ok(calls, "truncated bare call should be salvaged");
    assert.equal(calls[0].name, "write_file");
  });

  it("does not double-count when the array is wrapped in prose quotes", () => {
    const prose = 'Данные: "name": "x", "arguments": {} — просто упоминание в тексте.';
    // name value "x" without a surrounding object structure must not match
    assert.equal(extractBareToolCallsArray(prose), null);
  });
});
