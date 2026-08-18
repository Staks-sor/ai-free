import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { formatCompactTools, normalizeToolCallsForSchemas, parseModelToolCalls } from "../api/tool-calls.mjs";

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

  it("normalizes common argument aliases to the client tool schema", () => {
    const result = normalizeToolCallsForSchemas([
      { name: "Edit", arguments: JSON.stringify({ filePath: "a.js", oldText: "before", newText: "after" }) },
    ], [{
      type: "function",
      function: {
        name: "Edit",
        parameters: {
          type: "object",
          properties: { file_path: {}, old_string: {}, new_string: {} },
          required: ["file_path", "old_string", "new_string"],
        },
      },
    }]);

    assert.deepEqual(JSON.parse(result.calls[0].arguments), {
      file_path: "a.js",
      old_string: "before",
      new_string: "after",
    });
    assert.deepEqual(result.errors, []);
  });

  it("reports required arguments that cannot be recovered", () => {
    const result = normalizeToolCallsForSchemas([
      { name: "Edit", arguments: JSON.stringify({ file_path: "a.js", old_string: "before" }) },
    ], [{
      type: "function",
      function: { name: "Edit", parameters: { type: "object", required: ["file_path", "old_string", "new_string"] } },
    }]);

    assert.deepEqual(result.errors, [{ name: "Edit", missing: ["new_string"] }]);
  });

  it("compacts tool schemas by stripping redundant $schema and additionalProperties", () => {
    const verboseTools = [
      {
        type: "function",
        function: {
          name: "bash",
          description: "Execute bash command",
          parameters: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {
              command: { type: "string", description: "The command to run", $schema: "draft-7" },
            },
            required: ["command"],
            additionalProperties: false,
          },
        },
      },
    ];

    const compact = formatCompactTools(verboseTools);
    const parsed = JSON.parse(compact);
    assert.equal(parsed[0].function.name, "bash");
    assert.equal(parsed[0].function.parameters.$schema, undefined);
    assert.equal(parsed[0].function.parameters.additionalProperties, undefined);
    assert.equal(parsed[0].function.parameters.properties.command.type, "string");
  });
});
