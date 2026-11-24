import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { runCodeTask } from '../src/code-agent/run.mjs';
import { executeWorkspaceTool, spawnSyncSafe } from '../src/code-agent/executor.mjs';

for (const phase of ['model', 'checkpoint', 'native']) test(`Stop before ${phase} result prevents workspace mutation`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-cancel-'));
  const controller = new AbortController(); let requests = 0;
  const call = { tool: 'write_file', path: 'after-stop.txt', content: 'must not exist' };
  try {
    const result = await runCodeTask({ supportsNativeTools: phase === 'native', async complete() {
      requests++;
      if (phase !== 'checkpoint') controller.abort();
      return phase === 'native' ? { toolCall: { id: 'native-1', name: call.tool, arguments: { path: call.path, content: call.content } } } : { text: JSON.stringify(call) };
    } }, {}, root, 'Create a file', null, { signal: controller.signal, memoryEnabled: false,
      onCheckpoint(value) { if (phase === 'checkpoint' && value.phase === 'executing_tool') controller.abort(); } });
    assert.equal(fs.existsSync(path.join(root, call.path)), false);
    assert.equal(result.stopped, true);
    assert.equal(requests, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('executor rejects a pre-aborted signal before file side effects', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-executor-cancel-'));
  try {
    await assert.rejects(executeWorkspaceTool(root, { tool: 'write_file', path: 'cancelled.txt', content: 'x' },
      { signal: AbortSignal.abort() }), { name: 'AbortError' });
    assert.equal(fs.existsSync(path.join(root, 'cancelled.txt')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a provider AbortError finishes as stopped without another model turn', async () => {
  const controller = new AbortController();
  const result = await runCodeTask({ async complete() { controller.abort(); throw controller.signal.reason; } }, {}, os.tmpdir(), 'task', null,
    { signal: controller.signal, memoryEnabled: false });
  assert.equal(result.stopped, true); assert.match(result.message, /Остановлено/);
});

test('Windows Stop targets the owned process tree', async () => {
  const source = fs.readFileSync(new URL('../src/code-agent/executor.mjs', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('export function spawnSyncSafe'), source.indexOf('export function truncateOutput')).replaceAll('export function', 'function');
  const child = new EventEmitter(); child.pid = 1234; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
  const controller = new AbortController(), calls = [];
  const context = vm.createContext({ process: { platform: 'win32', env: {} }, setTimeout, clearTimeout,
    spawn: () => child, spawnSync: (command, args) => { calls.push({ command, args }); queueMicrotask(() => child.emit('close', 1, null)); return { status: 0 }; } });
  vm.runInContext(code, context);
  const completion = context.spawnSyncSafe('cmd.exe', [], { signal: controller.signal, timeoutMs: 100 });
  const rejected = assert.rejects(completion, { name: 'AbortError' }); controller.abort();
  try {
    assert.deepEqual(calls.map(c => ({ command: c.command, args: Array.from(c.args) })), [{ command: 'taskkill', args: ['/PID', '1234', '/T', '/F'] }]);
  } finally { child.emit('close', 1, null); await rejected; }
});

test('POSIX Stop terminates a command and its delayed-writing descendant', { skip: process.platform === 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-tree-stop-')), controller = new AbortController();
  try {
    const grandchild = "setTimeout(()=>require('node:fs').writeFileSync('after-stop.txt','late'),500)";
    const command = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'});require('node:fs').writeFileSync('ready','1');setTimeout(()=>{},10000)`;
    const completion = spawnSyncSafe(process.execPath, ['-e', command], { cwd: root, signal: controller.signal, timeoutMs: 3000 });
    const rejected = assert.rejects(completion, { name: 'AbortError' });
    for (let i = 0; i < 100 && !fs.existsSync(path.join(root, 'ready')); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(fs.existsSync(path.join(root, 'ready')), true); controller.abort(); await rejected;
    await new Promise(resolve => setTimeout(resolve, 600)); assert.equal(fs.existsSync(path.join(root, 'after-stop.txt')), false);
  } finally { controller.abort(); fs.rmSync(root, { recursive: true, force: true }); }
});
