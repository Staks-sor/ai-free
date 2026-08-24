import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  parseModelToolCalls,
  extractBareToolCalls,
  repairMissingArgumentsKey,
} from "../api/tool-calls.mjs";

// 2026-08-24: деградировавший Qwen роняет ключ "arguments" и вставляет
// объект аргументов сразу после имени: {"name": "read_file", {"path": ...}}.
// JSON невалиден → весь блок ```tool_calls падает в прозу → клиент видит
// "[Error parsing tool call JSON from model]" и ход теряется.

describe("repairMissingArgumentsKey", () => {
  it("inserts the arguments key when the model drops it", () => {
    const repaired = repairMissingArgumentsKey('[{"name": "read_file", {"path": "D:\\\\x.mjs"}}]');
    const parsed = JSON.parse(repaired);
    assert.equal(parsed[0].name, "read_file");
    assert.deepEqual(parsed[0].arguments, { path: "D:\\x.mjs" });
  });

  it("repairs multiple calls in one array", () => {
    const repaired = repairMissingArgumentsKey(
      '[{"name": "a", {"x": 1}}, {"name": "b", {"y": 2}}]',
    );
    const parsed = JSON.parse(repaired);
    assert.deepEqual(parsed[0].arguments, { x: 1 });
    assert.deepEqual(parsed[1].arguments, { y: 2 });
  });

  it("does not touch valid JSON", () => {
    const src = '[{"name": "terminal", "arguments": {"command": "ls"}}]';
    assert.equal(repairMissingArgumentsKey(src), src);
  });

  it("does not mangle flat calls without braces-object (valid JSON stays)", () => {
    const src = '{"name": "read_file", "path": "a.js"}';
    const out = repairMissingArgumentsKey(src);
    assert.equal(JSON.parse(out).path, "a.js");
    assert.equal(JSON.parse(out).name, "read_file");
  });
});

describe("model tool-call bridge with missing-arguments repair", () => {
  it("parses a fenced block whose first call is missing the arguments key", () => {
    const parsed = parseModelToolCalls([
      "Смотрю таймауты.",
      "```tool_calls",
      "[",
      "  {",
      '    "name": "read_file",',
      "    {",
      '      "path": "D:\\\\ai-free\\\\src\\\\x.mjs"',
      "    }",
      "  },",
      "  {",
      '    "name": "terminal",',
      '    "arguments": {"command": "grep -n QWEN .env"}',
      "  }",
      "]",
      "```",
    ].join("\n"));
    assert.equal(parsed.calls.length, 2);
    assert.equal(parsed.calls[0].name, "read_file");
    assert.deepEqual(JSON.parse(parsed.calls[0].arguments), { path: "D:\\ai-free\\src\\x.mjs" });
    assert.deepEqual(JSON.parse(parsed.calls[1].arguments), { command: "grep -n QWEN .env" });
  });

  it("recovers a bare malformed call embedded in prose", () => {
    const calls = extractBareToolCalls(
      'Держи: {"name": "write_file", {"path": "a.js", "content": "x"}}',
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "write_file");
    assert.deepEqual(JSON.parse(calls[0].arguments), { path: "a.js", content: "x" });
  });
});
