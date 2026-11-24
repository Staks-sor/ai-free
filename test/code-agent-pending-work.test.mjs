import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCodeTask } from '../src/code-agent/run.mjs';
import { shouldRejectTextOnlyCodeResult } from '../src/code-agent/loop-helpers.mjs';

const promise = "I now have everything needed. This is a large feature; I'll implement it as a coherent, self-contained increment. Let me start by extending the creature script with a third kind.";
const reads = ['[tool] read_file creature.gd'];

test('a promise after file reads is not completion, including a short follow-up', () => {
  assert.equal(shouldRejectTextOnlyCodeResult('ну что?', promise, reads), true);
  assert.equal(shouldRejectTextOnlyCodeResult('добавь червя', 'Сейчас добавлю червя в creature.gd.', reads), true);
});

test('read-only answers and requested implementation plans remain valid', () => {
  assert.equal(shouldRejectTextOnlyCodeResult('оцени код', 'The script uses two creature kinds.', reads), false);
  assert.equal(shouldRejectTextOnlyCodeResult('explain how to implement a worm', promise, reads), false);
  assert.equal(shouldRejectTextOnlyCodeResult('объясни реализацию', 'Сейчас добавлю пример реализации.', reads), false);
  assert.equal(shouldRejectTextOnlyCodeResult('составь план реализации', promise, reads), false);
  assert.equal(shouldRejectTextOnlyCodeResult('добавь червя', 'Added the worm; tests passed.', ['[tool] write_file creature.gd']), false);
});

for (const format of ['text', 'finish', 'native']) {
  test(`read → pending ${format} → actual write → finish`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-work-'));
    fs.writeFileSync(path.join(dir, 'creature.gd'), 'old');
    const requests = [];
    const client = {
      supportsNativeTools: format === 'native',
      async complete(request) {
        requests.push(request);
        const step = requests.length;
        if (step === 1) return { text: '{"tool":"read_file","path":"creature.gd"}', lastAssistantMessageId: 'read' };
        if (step === 2) return {
          text: format === 'finish' ? JSON.stringify({ tool: 'finish', message: promise }) : promise,
          ...(format === 'native' ? { toolCall: { id: 'pending', name: 'finish', arguments: { message: promise } } } : {}),
          lastAssistantMessageId: 'promise',
        };
        if (step === 3) return { text: '{"tool":"write_file","path":"creature.gd","content":"worm"}', lastAssistantMessageId: 'write' };
        return { text: '{"tool":"finish","message":"Added the worm."}', lastAssistantMessageId: 'done' };
      },
    };
    try {
      const result = await runCodeTask(client, { sessionId: 'test' }, dir, 'ну что?', null, { noToolTextRetries: 2 });
      assert.equal(fs.readFileSync(path.join(dir, 'creature.gd'), 'utf8'), 'worm');
      assert.equal(result.message, 'Added the worm.');
      assert.equal(requests.length, 4);
      assert.equal(requests[2].parentMessageId, 'promise');
      assert.match(requests[2].prompt, /Continue the task now/);
      if (format === 'native') assert.equal(requests[2].toolResult.toolCallId, 'pending');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

for (const format of ['text', 'finish']) {
  test(`repeated pending ${format} is bounded rather than successful`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-work-'));
    let calls = 0;
    try {
      const result = await runCodeTask({ async complete() {
        calls++;
        return { text: format === 'finish' ? JSON.stringify({ tool: 'finish', message: promise }) : promise };
      } }, { sessionId: 'test' }, dir, 'ну что?', null, { noToolTextRetries: 2 });
      assert.match(result.message, /^Error:/);
      assert.equal(result.failed, true);
      assert.equal(calls, 3);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
