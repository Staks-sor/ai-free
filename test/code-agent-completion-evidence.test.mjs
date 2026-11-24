import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCodeTask } from '../src/code-agent/run.mjs';

for (const format of ['text', 'finish', 'native']) {
  test(`read-only ${format} change claim requires a successful workspace action`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-evidence-'));
    fs.writeFileSync(path.join(dir, 'probe.txt'), 'OLD');
    let steps = 0;
    try {
      const result = await runCodeTask({ supportsNativeTools: format === 'native', async complete() {
        steps++;
        if (steps === 1) return { text: '{"tool":"read_file","path":"probe.txt"}' };
        if (steps === 2) return { text: format === 'finish' ? '{"tool":"finish","message":"Исправил probe.txt."}' : 'Исправил probe.txt.',
          ...(format === 'native' ? { toolCall: { id: 'unsupported', name: 'finish', arguments: { message: 'Исправил probe.txt.' } } } : {}) };
        if (steps === 3) return { text: '{"tool":"write_file","path":"probe.txt","content":"NEW"}' };
        return { text: '{"tool":"finish","message":"Исправил probe.txt."}' };
      } }, { sessionId: 'test' }, dir, 'исправь probe.txt', null);
      assert.equal(fs.readFileSync(path.join(dir, 'probe.txt'), 'utf8'), 'NEW');
      assert.notEqual(result.failed, true);
      assert.equal(steps, 4);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('repeated completion claims after reads fail within the repair budget', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-evidence-'));
  fs.writeFileSync(path.join(dir, 'probe.txt'), 'OLD');
  let steps = 0;
  try {
    const result = await runCodeTask({ async complete() {
      return { text: ++steps === 1 ? '{"tool":"read_file","path":"probe.txt"}' : '{"tool":"finish","message":"Исправил probe.txt."}' };
    } }, { sessionId: 'test' }, dir, 'исправь probe.txt', null, { noToolTextRetries: 1 });
    assert.equal(result.failed, true);
    assert.equal(fs.readFileSync(path.join(dir, 'probe.txt'), 'utf8'), 'OLD');
    assert.equal(steps, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('requested plans can finish without editing workspace files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-evidence-'));
  try {
    const result = await runCodeTask({ async complete() {
      return { text: '{"tool":"finish","message":"Готово: план исправления состоит из трёх шагов."}' };
    } }, { sessionId: 'test' }, dir, 'составь план исправления проекта', null);
    assert.notEqual(result.failed, true);
    assert.equal(result.toolLogs.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
