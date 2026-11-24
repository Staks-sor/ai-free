import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCodeTask } from '../src/code-agent/run.mjs';

const refusal = 'В этой сессии у меня сейчас нет доступного workspace инструмента для выполнения list_files.';

for (const format of ['text', 'finish']) {
  test(`workspace refusal as ${format} recovers through a real read before editing`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-recovery-'));
    fs.writeFileSync(path.join(dir, 'probe.txt'), 'BEFORE');
    let requests = 0;
    const executed = [];
    try {
      const result = await runCodeTask({ async complete(request) {
        requests++;
        if (requests === 1) return { text: format === 'finish' ? JSON.stringify({ tool: 'finish', message: refusal }) : refusal };
        if (requests === 2) {
          assert.match(request.prompt, /Tool result for list_files:/);
          assert.match(request.prompt, /probe\.txt/);
          return { text: '{"tool":"read_file","path":"probe.txt"}' };
        }
        if (requests === 3) {
          assert.match(request.prompt, /BEFORE/);
          return { text: '{"tool":"write_file","path":"probe.txt","content":"AFTER"}' };
        }
        return { text: '{"tool":"finish","message":"Изменил probe.txt."}' };
      } }, { sessionId: 'test' }, dir, 'исправь probe.txt', null, {
        onTool: call => executed.push(call.tool),
      });
      assert.equal(result.failed, undefined);
      assert.equal(fs.readFileSync(path.join(dir, 'probe.txt'), 'utf8'), 'AFTER');
      assert.deepEqual(executed, ['list_files', 'read_file', 'write_file']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('repeated workspace refusals probe once and end as failure, including finish', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-recovery-'));
  const executed = [];
  let requests = 0;
  try {
    const result = await runCodeTask({ async complete() {
      requests++;
      return { text: JSON.stringify({ tool: 'finish', message: refusal }) };
    } }, { sessionId: 'test' }, dir, 'исправь проект', null, {
      noToolTextRetries: 2, onTool: call => executed.push(call.tool),
    });
    assert.equal(result.failed, true);
    assert.deepEqual(executed, ['list_files']);
    assert.equal(requests, 4);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const options of [
  { allowedTools: ['read_file', 'finish'] },
  { browserOnly: true },
  { resumeState: { prompt: 'Continue', toolLogs: ['[tool] read_file probe.txt'] } },
]) {
  test(`workspace recovery respects restrictions/history ${JSON.stringify(options)}`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-recovery-'));
    const executed = [];
    try {
      const result = await runCodeTask({ async complete() {
        return { text: JSON.stringify({ tool: 'finish', message: refusal }) };
      } }, { sessionId: 'test' }, dir, 'исправь проект', null, {
        ...options, noToolTextRetries: 0, onTool: call => executed.push(call.tool),
      });
      assert.equal(result.failed, true);
      assert.deepEqual(executed, []);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
