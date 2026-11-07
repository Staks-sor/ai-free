import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Writable } from "node:stream";

import { StreamParser } from "../api/openai-handler.mjs";

function makeWritableResponse() {
  const res = new Writable({
    write(chunk, _enc, cb) {
      this.chunks = this.chunks || [];
      this.chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  res.statusCode = 200;
  res.setHeader = () => {};
  res.chunks = [];
  return res;
}

function parseSseJsonEvents(raw) {
  return raw
    .split("\n\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

const WRITE_FILE_TOOL = {
  type: "function",
  function: {
    name: "write_file",
    description: "Write a file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
};

// Сценарий инцидента 2026-10-23: output-limit обрезал вызов write_file
// посреди content, ключ path (шёл после content) исчез. Ремонт JSON
// «спасал» вызов без path → Hermes отвечал missing required field 'path'
// → модель повторяла тот же вызов → бесконечный цикл.
describe("StreamParser guard against output-limit truncated tool calls", () => {
  it("does NOT emit a crippled call when the fence never closed and required fields are missing", async () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.8-max", res, { tools: [WRITE_FILE_TOOL] });

    // Обрыв посреди content; fence не закрыт, path нет.
    parser.onText('Замысел: записать README.\n```tool_calls\n[\n  {\n    "name": "write_file",\n    "arguments": {\n      "content": "# Сборка FDS E+ (FDSE) для Windows x64\n\nИнструкция по компиляции');
    await parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    const toolCallEvents = events.filter((e) => e.choices[0].delta.tool_calls);
    assert.equal(toolCallEvents.length, 0, "crippled tool call must not be delivered");

    const content = events.map((e) => e.choices[0].delta.content || "").join("");
    assert.match(content, /truncated by the output token limit/i);
    assert.match(content, /split/i);
    assert.equal(events.at(-1).choices[0].finish_reason, "stop");
  });

  it("still delivers a valid call when truncation happened after all required fields", async () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.8-max", res, { tools: [WRITE_FILE_TOOL] });

    // path и content на месте; обрыв съел только закрывающий fence.
    parser.onText('```tool_calls\n[{"name":"write_file","arguments":{"path":"E:/tmp/a.md","content":"hello"}}]');
    await parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    const toolCall = events.find((e) => e.choices[0].delta.tool_calls)?.choices[0].delta.tool_calls[0];
    assert.ok(toolCall, "valid call must be delivered");
    assert.equal(toolCall.function.name, "write_file");
    assert.deepEqual(JSON.parse(toolCall.function.arguments), { path: "E:/tmp/a.md", content: "hello" });
    assert.equal(events.at(-1).choices[0].finish_reason, "tool_calls");
  });

  it("delivers a fully fenced call unchanged (no regression)", async () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.8-max", res, { tools: [WRITE_FILE_TOOL] });

    parser.onText('```tool_calls\n[{"name":"write_file","arguments":{"path":"E:/tmp/a.md","content":"hello"}}]\n```');
    await parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    assert.ok(events.some((e) => e.choices[0].delta.tool_calls));
    assert.equal(events.at(-1).choices[0].finish_reason, "tool_calls");
  });

  // Инцидент 2026-10-23 (телеметрия 14-42/14-43): content write_file содержит
  // вложенные markdown-фенсы ``` — парсер рвал JSON на ПЕРВОМ внутреннем ```
  // → path (последний ключ) терялся → «missing required field» → цикл.
  it("does not break the JSON at an INNER markdown fence inside content (path last)", async () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.8-max", res, { tools: [WRITE_FILE_TOOL] });

    const args = JSON.stringify({
      content: "# Сборка FDSE\n\n```\nMSYS_NO_PATHCONV=1 cmd.exe /c nmake /f ../makefile\n```\n\nКонец инструкции",
      path: "E:/FIREGOAWAY/GitHub/FDS_source/FIREMODELS/fds/Build/impi_intel_win_ng/README.md",
    });
    parser.onText('Замысел: записать README.\n```tool_calls\n[\n  {\n    "name": "write_file",\n    "arguments": ' + args + '\n  }\n]\n```');
    await parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    const toolCall = events.find((e) => e.choices[0].delta.tool_calls)?.choices[0].delta.tool_calls[0];
    assert.ok(toolCall, "tool call must be delivered");
    assert.equal(toolCall.function.name, "write_file");
    const parsed = JSON.parse(toolCall.function.arguments);
    assert.equal(parsed.path, "E:/FIREGOAWAY/GitHub/FDS_source/FIREMODELS/fds/Build/impi_intel_win_ng/README.md");
    assert.match(parsed.content, /MSYS_NO_PATHCONV=1/);
    assert.match(parsed.content, /```\n/);
  });
});
