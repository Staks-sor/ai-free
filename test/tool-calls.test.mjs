import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { parseModelToolCalls } from "../api/tool-calls.mjs";

describe("model tool-call bridge", () => {
  it("parses markdown tool_calls blocks into normalized calls", () => {
    const parsed = parseModelToolCalls(`Сейчас посмотрю.\n\n\`\`\`tool_calls
[
  {
    "name": "exec_command",
    "arguments": {
      "cmd": "find . -maxdepth 2 -type f"
    }
  }
]
\`\`\``);

    assert.equal(parsed.content, "Сейчас посмотрю.");
    assert.deepEqual(parsed.calls, [
      {
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "find . -maxdepth 2 -type f" }),
      },
    ]);
  });

  it("leaves normal text untouched", () => {
    const parsed = parseModelToolCalls("Обычный ответ без инструментов.");
    assert.equal(parsed.content, "Обычный ответ без инструментов.");
    assert.deepEqual(parsed.calls, []);
  });

  it("parses XML tool_call blocks into normalized calls", () => {
    const parsed = parseModelToolCalls('Сейчас посмотрю.\n<tool_call name="read_file">{"path":"src/app.js"}</tool_call>');
    assert.equal(parsed.content, "Сейчас посмотрю.");
    assert.deepEqual(parsed.calls, [
      {
        name: "read_file",
        arguments: JSON.stringify({ path: "src/app.js" }),
      },
    ]);
  });

  it("parses Qwen function parameter XML into normalized calls", () => {
    const parsed = parseModelToolCalls([
      "<function=write_file>",
      "<parameter=path>src/app.js</parameter>",
      '<parameter=content>{"ok":true}</parameter>',
      "</function>",
    ].join(""));

    assert.equal(parsed.content, "");
    assert.deepEqual(parsed.calls, [
      {
        name: "write_file",
        arguments: JSON.stringify({ path: "src/app.js", content: { ok: true } }),
      },
    ]);
  });
});
