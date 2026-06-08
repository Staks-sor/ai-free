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
});
