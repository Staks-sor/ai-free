import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSyncSafe } from '../src/code-agent/executor.mjs';

test('caps captured command output without changing exit status', async () => {
  const result = await spawnSyncSafe(process.execPath, ['-e', "process.stdout.write('x'.repeat(2_000_000)); process.stderr.write('y'.repeat(2_000_000))"], { cwd: process.cwd(), timeoutMs: 5000 });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.length <= 256 * 1024);
  assert.ok(result.stderr.length <= 256 * 1024);
  assert.equal(result.outputTruncated, true);
});

test('abort cancels an active command instead of waiting for its timeout', async () => {
  const controller = new AbortController();
  const running = spawnSyncSafe(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: process.cwd(), timeoutMs: 5000, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 30);
  try { await assert.rejects(running, error => error.name === 'AbortError'); }
  finally { clearTimeout(timer); }
});

test('timeout kills a command that ignores SIGTERM and releases the worker', async () => {
  const started = Date.now();
  const running = spawnSyncSafe(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { cwd: process.cwd(), timeoutMs: 100 });
  const cleanup = setTimeout(() => {}, 2000);
  try {
    const result = await running;
    assert.equal(result.timedOut, true);
    assert.equal(result.signal, 'SIGKILL');
    assert.ok(Date.now() - started < 1500);
  } finally { clearTimeout(cleanup); }
});

test('read_file reads only its byte budget instead of allocating the whole file', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { executeWorkspaceTool } = await import('../src/code-agent/executor.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-bounded-read-'));
  const target = path.join(root, 'large.txt');
  fs.writeFileSync(target, 'x'.repeat(500_000));
  const original = fs.default.readFileSync;
  fs.default.readFileSync = function(file, ...args) {
    if (file === target) throw new Error('unbounded read');
    return original.call(this, file, ...args);
  };
  try {
    const result = await executeWorkspaceTool(root, { tool: 'read_file', path: 'large.txt', maxBytes: 1024 });
    assert.equal(result.readBytes, 1024);
    assert.equal(result.content.length, 1024);
    assert.equal(result.truncated, true);
  } finally { fs.default.readFileSync = original; fs.rmSync(root, { recursive: true, force: true }); }
});

test('workspace command propagates cancellation rather than requesting installation', async () => {
  const { executeWorkspaceTool } = await import('../src/code-agent/executor.mjs');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(executeWorkspaceTool(process.cwd(), { tool: 'run_command', cmd: 'node', args: ['--version'] }, { signal: controller.signal }), error => error.name === 'AbortError');
});
