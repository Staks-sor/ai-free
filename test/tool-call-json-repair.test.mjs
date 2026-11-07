import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  parseModelToolCalls,
  extractBareToolCalls,
  repairMissingArgumentsKey,
  terminateUnterminatedStrings,
  escapeUnescapedInnerQuotes,
  repairToolCallJson,
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

// 2026-09-07, Hermes (Telegram-шлюз): Qwen роняет ЗАКРЫВАЮЩУЮ кавычку
// строкового значения перед переносом строки + не экранирует внутренние
// кавычки grep-паттерна. Оба дефекта сложены в одном пейлоаде — все прежние
// ремонты падали, клиент получал "[Error parsing tool call JSON from model]".
// В command-строках НЕТ закрывающей кавычки перед переносом строки.
const HERMES_PAYLOAD = `[
  { "name": "terminal", "arguments": { "command": "tasklist | grep -i -E "hermes|python" | head -20
    } },
  { "name": "terminal", "arguments": { "command": "tail -100 /c/Users/User/AppData/Local/hermes/logs/gateway.log
    } },
  { "name": "terminal", "arguments": { "command": "tail -50 /c/Users/User/AppData/Local/hermes/logs/errors.log
    } }
]`;

describe("terminateUnterminatedStrings", () => {
  it("does not touch valid JSON", () => {
    const src = '[{"name": "terminal", "arguments": {"command": "ls"}}]';
    assert.equal(terminateUnterminatedStrings(src), src);
  });

  it("preserves legit multi-line string content (write_file)", () => {
    const src = `[
  { "name": "write_file", "arguments": { "path": "a.txt", "content": "line1
line2" } }
]`;
    assert.equal(terminateUnterminatedStrings(src), src);
  });

  it("inserts the dropped closing quote before a newline followed by a structural char", () => {
    const src = `[
  { "name": "terminal", "arguments": { "command": "ps aux
    } }
]`;
    const fixed = terminateUnterminatedStrings(src);
    const parsed = JSON.parse(fixed);
    assert.equal(parsed[0].arguments.command, "ps aux");
  });

  it("restores all three Hermes strings so the quote-escape chain can finish the repair", () => {
    const fixed = escapeUnescapedInnerQuotes(terminateUnterminatedStrings(HERMES_PAYLOAD));
    const parsed = JSON.parse(fixed);
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0].arguments.command, 'tasklist | grep -i -E "hermes|python" | head -20');
    assert.equal(parsed[1].arguments.command, "tail -100 /c/Users/User/AppData/Local/hermes/logs/gateway.log");
    assert.equal(parsed[2].arguments.command, "tail -50 /c/Users/User/AppData/Local/hermes/logs/errors.log");
  });
});

describe("model tool-call bridge with dropped-closing-quote repair", () => {
  it("recovers the exact Hermes payload from a fenced block", () => {
    const parsed = parseModelToolCalls(
      "Проверяю процессы.\n\n```tool_calls\n" + HERMES_PAYLOAD + "\n```\n",
    );
    assert.equal(parsed.content, "Проверяю процессы.");
    assert.equal(parsed.calls.length, 3);
    assert.equal(parsed.calls[0].name, "terminal");
    assert.deepEqual(JSON.parse(parsed.calls[0].arguments), {
      command: 'tasklist | grep -i -E "hermes|python" | head -20',
    });
    assert.deepEqual(JSON.parse(parsed.calls[1].arguments), {
      command: "tail -100 /c/Users/User/AppData/Local/hermes/logs/gateway.log",
    });
    assert.deepEqual(JSON.parse(parsed.calls[2].arguments), {
      command: "tail -50 /c/Users/User/AppData/Local/hermes/logs/errors.log",
    });
  });

  it("recovers a mixed array of broken and valid calls", () => {
    const parsed = parseModelToolCalls(
      "```tool_calls\n[\n" +
        '  { "name": "terminal", "arguments": { "command": "echo "hi"\n    } },\n' +
        '  { "name": "terminal", "arguments": { "command": "pwd" } }\n' +
        "]\n```",
    );
    assert.equal(parsed.calls.length, 2);
    assert.deepEqual(JSON.parse(parsed.calls[0].arguments), { command: 'echo "hi"' });
    assert.deepEqual(JSON.parse(parsed.calls[1].arguments), { command: "pwd" });
  });

  it("parses fenced write_file content with raw multi-line string", () => {
    const parsed = parseModelToolCalls(
      "```tool_calls\n[\n" +
        '  { "name": "write_file", "arguments": { "path": "a.txt", "content": "line1\nline2" } }\n' +
        "]\n```",
    );
    assert.equal(parsed.calls.length, 1);
    assert.deepEqual(JSON.parse(parsed.calls[0].arguments), {
      path: "a.txt",
      content: "line1\nline2",
    });
  });
});

// 2026-09-07, Hermes (Telegram, 20:49): модель выдала ГИБРИД — первые вызовы
// валидным JSON с корректно экранированными кавычками, последние — родным
// Qwen-форматом <parameter=KEY>VALUE</parameter> внутри JSON-массива.
// Из-за XML-хвоста весь блок падал, теряя и валидные вызовы.
const HERMES_HYBRID_PAYLOAD = `[
  {
    "name": "terminal",
    "arguments": {
      "command": "cd \\"E:/FIREGOAWAY/GitHub/HermesRAG\\" && find . -name \\"пансионат_page1.png\\" -o -name \\"Pansionat.png\\" 2>/dev/null | head -5"
    }
  },
  {
    "name": "terminal",
    "arguments": {
      "command": "ls -la \\"C:/Users/User/AppData/Local/hermes/cache/documents/\\" | grep -i панс"
    }
  },
  {
    "name": "skill_view",
<parameter=name>
estestvennoe-provetrivanie
</parameter>
  },
  {
    "name": "skill_view",
<parameter=name>
инженер-расчетчик
</parameter>
  }
]`;

describe("model tool-call bridge with JSON/XML hybrid repair", () => {
  it("recovers the exact Hermes hybrid payload with all four calls", () => {
    const parsed = parseModelToolCalls(
      "```tool_calls\n" + HERMES_HYBRID_PAYLOAD + "\n```",
    );
    assert.equal(parsed.calls.length, 4);
    assert.equal(parsed.calls[0].name, "terminal");
    assert.equal(
      JSON.parse(parsed.calls[0].arguments).command.includes("пансионат_page1.png"),
      true,
    );
    assert.equal(parsed.calls[2].name, "skill_view");
    assert.deepEqual(JSON.parse(parsed.calls[2].arguments), {
      name: "estestvennoe-provetrivanie",
    });
    assert.deepEqual(JSON.parse(parsed.calls[3].arguments), {
      name: "инженер-расчетчик",
    });
  });
});

// Hermes CLI (2026-09-11): write_file с полностью экранированным однострочным
// content, но модель потеряла закрывающую } объекта вызова перед ].
describe("repairToolCallJson closing-brace mismatch", () => {
  it("recovers an escaped one-line write_file call missing a closing brace", () => {
    const json = '[{"name": "write_file", "arguments": {"path": "E:\\\\HermesRAG\\\\find_xrefs.py", "content": "print(\\"hi\\")\\n"}\n]';
    const parsed = repairToolCallJson(json);
    assert.ok(parsed, "expected a repaired parse");
    const list = Array.isArray(parsed) ? parsed : [parsed];
    assert.equal(list[0].name, "write_file");
    assert.equal(list[0].arguments.path, "E:\\HermesRAG\\find_xrefs.py");
    assert.equal(list[0].arguments.content, 'print("hi")\n');
  });
});
