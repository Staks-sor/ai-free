import { it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DeepSeekChatClient } from "../src/providers/deepseek/client.mjs";
import { runCodeTask } from "../src/code-agent/run.mjs";

const screenshotCall = [
  '<｜DSML｜calls>',
  '<｜DSML｜invoke name="read_file">',
  '<｜DSML｜parameter name="path" string="true">docs/HOST_AND_ORGANS.md</｜DSML｜parameter>',
  '<｜DSML｜parameter name="maxBytes" string="false">60000</｜DSML｜parameter>',
  '</｜DSML｜invoke>',
  '</｜DSML｜calls>',
].join('\n');

it("parses the DeepSeek DSML read_file from the screenshot", () => {
  const client = new DeepSeekChatClient({});
  assert.deepEqual(client.parseToolCall(screenshotCall), {
    tool: "read_file", path: "docs/HOST_AND_ORGANS.md", maxBytes: 60000,
  });
});

it("preserves strings and converts explicitly typed DSML parameters", () => {
  const client = new DeepSeekChatClient({});
  assert.deepEqual(client.parseToolCall(
    '<|DSML|function_calls><|DSML|invoke name="ask_user">' +
    '<|DSML|parameter name="question" string="true">false</|DSML|parameter>' +
    '<|DSML|parameter name="choices" string="false">["yes","no"]</|DSML|parameter>' +
    '</|DSML|invoke></|DSML|function_calls>'
  ), { tool: "ask_user", question: "false", choices: ["yes", "no"] });
});

it("rejects multiple or malformed DSML calls instead of losing actions", () => {
  const client = new DeepSeekChatClient({});
  assert.throws(() => client.parseToolCall(screenshotCall + screenshotCall), /DSML/i);
  assert.throws(() => client.parseToolCall(screenshotCall.replace('60000', 'not-a-number')), /DSML/i);
  assert.throws(() => client.parseToolCall(screenshotCall.replace('name="maxBytes"', 'name="tool"')), /DSML/i);
});

it("executes DSML through the code loop and returns the final answer", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepseek-dsml-"));
  try {
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "docs/HOST_AND_ORGANS.md"), "LOCAL_EVIDENCE");
    const client = new DeepSeekChatClient({});
    let calls = 0;
    client.complete = async (request) => {
      calls += 1;
      if (calls === 1) return { text: screenshotCall, lastAssistantMessageId: 1 };
      assert.match(request.prompt, /LOCAL_EVIDENCE/);
      assert.equal(request.parentMessageId, 1);
      return { text: '{"tool":"finish","message":"Документ прочитан."}', lastAssistantMessageId: 2 };
    };
    const result = await runCodeTask(client, {}, root, "прочитай документ", null, { memoryEnabled: false });
    assert.equal(calls, 2);
    assert.equal(result.message, "Документ прочитан.");
    assert.match(result.toolLogs[0], /read_file docs\/HOST_AND_ORGANS.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const hybridAppend = 'Теперь пишу реализацию.\n\n' +
  '{"tool":"append_file","path":"creature.gd","content":"\n\n\\nfunc worm_reach() -> float:\\n\\treturn 0.86\\n"}\n' +
  '</｜｜DSML｜｜ parameter>\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>';

it('accepts the observed JSON append with literal newlines and orphan DSML closing tags', () => {
  const client = new DeepSeekChatClient({});
  assert.deepEqual(client.parseToolCall(hybridAppend), {
    tool: 'append_file', path: 'creature.gd', content: '\n\n\nfunc worm_reach() -> float:\n\treturn 0.86\n',
  });
  assert.throws(() => client.parseToolCall('</｜DSML｜calls>'), /DSML/i);
});

it('executes the hybrid append exactly once through the workspace loop', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-hybrid-'));
  try {
    fs.writeFileSync(path.join(root, 'creature.gd'), '# original');
    const client = new DeepSeekChatClient({});
    let calls = 0;
    client.complete = async request => {
      calls++;
      if (calls === 1) return { text: hybridAppend, lastAssistantMessageId: 32 };
      assert.equal(request.parentMessageId, 32);
      assert.match(request.prompt, /Tool result for append_file/);
      return { text: '{"tool":"finish","message":"Added the worm function."}', lastAssistantMessageId: 34 };
    };
    const result = await runCodeTask(client, {}, root, 'добавь функцию', null, { memoryEnabled: false });
    assert.equal(calls, 2);
    assert.equal(result.message, 'Added the worm function.');
    assert.equal(fs.readFileSync(path.join(root, 'creature.gd'), 'utf8'), '# original\n\n\nfunc worm_reach() -> float:\n\treturn 0.86\n');
    assert.equal(result.toolLogs.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
