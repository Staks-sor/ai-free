import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  escapeUnescapedInnerQuotes,
  parseModelToolCalls,
} from "../src/../api/tool-calls.mjs";

// Точные сэмплы из лога пользователя 2026-08-21: Qwen кладёт shell-команды
// с двойными кавычками в JSON-строку БЕЗ экранирования.

const SAMPLE_1 = `[
  {
    "name": "terminal",
    "arguments": {
      "command": "cd /d/ai-free && grep -n "export function extractBareToolCallsArray" -A 80 api/tool-calls.mjs | head -100"
    }
  }
]`;

const SAMPLE_2 = `[
  {
    "name": "terminal",
    "arguments": {
      "command": "cd /d/ai-free && grep -n "extractBareToolCallsArray\\|repairTruncatedToolCallJson" api/openai-handler.mjs api/tool-calls.mjs | head -20"
    }
  }
]`;

describe("escapeUnescapedInnerQuotes", () => {
  it("чинит неэкранированные кавычки вокруг grep-паттерна (сэмпл 1)", () => {
    const fixed = escapeUnescapedInnerQuotes(SAMPLE_1);
    const parsed = JSON.parse(fixed);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].name, "terminal");
    assert.equal(
      parsed[0].arguments.command,
      'cd /d/ai-free && grep -n "export function extractBareToolCallsArray" -A 80 api/tool-calls.mjs | head -100',
    );
  });

  it("чинит кавычки + невалидный эскейп \\| (сэмпл 2)", () => {
    // В сыром тексте модели стоит \| — невалидный JSON-эскейп.
    const raw = `[{"name":"terminal","arguments":{"command":"grep -n "a\\|b" file"}}]`;
    const fixed = escapeUnescapedInnerQuotes(raw);
    const parsed = JSON.parse(fixed);
    assert.equal(parsed[0].arguments.command, 'grep -n "a\\|b" file');
  });

  it("не портит уже валидный JSON с корректно экранированными кавычками", () => {
    const valid = `[
  {
    "name": "terminal",
    "arguments": {
      "command": "grep -n \\"foo\\" bar"
    }
  }
]`;
    const fixed = escapeUnescapedInnerQuotes(valid);
    const parsed = JSON.parse(fixed);
    assert.equal(parsed[0].arguments.command, 'grep -n "foo" bar');
  });

  it("кавычка перед структурным символом остаётся закрывающей", () => {
    const fixed = escapeUnescapedInnerQuotes(`{"a": "x", "b": "y"}`);
    assert.deepEqual(JSON.parse(fixed), { a: "x", b: "y" });
  });

  it("parseModelToolCalls спасает вызов из fence-блока с битыми кавычками", () => {
    const text =
      "Проверяю реализацию:\n\n```tool_calls\n" + SAMPLE_1 + "\n```\n";
    const { calls } = parseModelToolCalls(text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "terminal");
    const args = JSON.parse(calls[0].arguments);
    assert.equal(args.command.startsWith("cd /d/ai-free && grep -n"), true);
    assert.equal(args.command.includes('"export function extractBareToolCallsArray"'), true);
  });
});
