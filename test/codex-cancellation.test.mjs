import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { CodexAppServerClient, CodexAppServerRpc } from '../src/providers/codex/app-server-client.mjs';
import { createCodexAgentAdapter } from '../src/providers/codex/agent-adapter.mjs';

function fixture(onRequest = () => {}) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const requests = []; const reply = (id, result) => child.stdout.write(JSON.stringify({ id, result }) + '\n');
  child.stdin = { write(line) { const message = JSON.parse(line); if (!message.id) return;
    requests.push(message); if (onRequest(message, reply) === false) return;
    queueMicrotask(() => reply(message.id, message.method === 'thread/start' ? { thread: { id: 'thread' } }
      : message.method === 'turn/start' ? { turn: { id: 'turn' } } : {})); } };
  child.kill = () => { child.emit('close', 0); };
  const rpc = new CodexAppServerRpc({ spawnProcess: () => child, requestTimeoutMs: 40 });
  const alive = setTimeout(() => {}, 5000), close = rpc.close.bind(rpc);
  rpc.close = () => { clearTimeout(alive); close(); };
  const emit = (method, params) => child.stdout.write(JSON.stringify({ method, params }) + '\n');
  return { rpc, requests, emit, reply, child };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Codex adapter passes the task AbortSignal to its client', async () => {
  const signal = new AbortController().signal; let actual;
  await createCodexAgentAdapter({ async complete(request) { actual = request.signal; return { text: '{}' }; } }).complete({ prompt: 'task', signal });
  assert.equal(actual, signal);
});

test('Codex app-server sends localImage input and retains its private file until the turn completes', async () => {
  const f = fixture(); const client = new CodexAppServerClient({ rpc: f.rpc });
  const image = { name: 'desktop.png', mimeType: 'image/png', dataBase64: 'cGl4ZWxz' };
  try {
    const completion = client.complete({ prompt: 'inspect', images: [image] });
    await tick();
    const request = f.requests.find(item => item.method === 'turn/start');
    const localImage = request?.params.input.find(item => item.type === 'localImage');
    assert.equal(client.supportsImageAttachments, true);
    assert.equal(localImage?.detail, 'original');
    assert.ok(localImage?.path);
    assert.equal(readFileSync(localImage.path).toString('base64'), image.dataBase64);
    if (process.platform !== 'win32') assert.equal(statSync(localImage.path).mode & 0o777, 0o600);
    f.emit('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'completed', items: [{ type: 'agentMessage', text: 'seen' }] } });
    await completion;
    assert.equal(existsSync(localImage.path), false);
  } finally { client.close(); }
});

test('Codex Stop interrupts the active turn and releases its waiter', { timeout: 500 }, async () => {
  const f = fixture(); const client = new CodexAppServerClient({ rpc: f.rpc }); const controller = new AbortController();
  try {
    const completion = client.complete({ prompt: 'task', signal: controller.signal, images: [{ mimeType: 'image/png', dataBase64: 'cGl4ZWxz' }] });
    const rejected = assert.rejects(completion, { name: 'AbortError' });
    await tick(); controller.abort(); await rejected;
    const interrupt = f.requests.find(r => r.method === 'turn/interrupt');
    assert.deepEqual(interrupt?.params, { threadId: 'thread', turnId: 'turn' });
    const localImage = f.requests.find(r => r.method === 'turn/start')?.params.input.find(item => item.type === 'localImage');
    assert.equal(existsSync(localImage.path), false);
    assert.equal(f.rpc.turnWaiters.size, 0);
  } finally { client.close(); }
});

test('Stop during turn/start still interrupts its acknowledged turn', { timeout: 500 }, async () => {
  let pending;
  const f = fixture((message, reply) => { if (message.method === 'turn/start') { pending = () => reply(message.id, { turn: { id: 'late' } }); return false; } });
  const client = new CodexAppServerClient({ rpc: f.rpc }); const controller = new AbortController();
  try {
    const completion = client.complete({ prompt: 'task', signal: controller.signal });
    const rejected = assert.rejects(completion, { name: 'AbortError' });
    await tick(); controller.abort(); pending(); await rejected;
    assert.deepEqual(f.requests.find(r => r.method === 'turn/interrupt')?.params, { threadId: 'thread', turnId: 'late' });
  } finally { client.close(); }
});

test('silent RPC requests have a deadline and discard pending entries', { timeout: 500 }, async () => {
  const f = fixture(message => message.method === 'silent' ? false : undefined);
  try {
    await f.rpc.start();
    await assert.rejects(f.rpc.request('silent', {}, { timeoutMs: 10 }), error => error.code === 'CODEX_RPC_TIMEOUT');
    assert.equal(f.rpc.pending.size, 0);
  } finally { f.rpc.close(); }
});

test('silent initialization times out and closes its process', { timeout: 500 }, async () => {
  const f = fixture(() => false);
  try { await assert.rejects(f.rpc.start(), error => error.code === 'CODEX_RPC_TIMEOUT'); assert.equal(f.rpc.child, null); }
  finally { f.rpc.close(); }
});

test('completed Codex turn buffers are removed when consumed', async () => {
  const f = fixture(); await f.rpc.start();
  try {
    for (let i = 0; i < 100; i++) {
      f.emit('turn/completed', { threadId: 'thread', turn: { id: String(i), status: 'completed', items: [{ type: 'agentMessage', text: 'done' }] } });
      assert.equal((await f.rpc.waitForTurn('thread', String(i))).text, 'done');
    }
    assert.equal(f.rpc.turnBuffers.size, 0);
    const waiting = f.rpc.waitForTurn('thread', 'waiting');
    f.emit('turn/completed', { threadId: 'thread', turn: { id: 'waiting', status: 'completed' } }); await waiting;
    assert.equal(f.rpc.turnBuffers.size, 0);
  } finally { f.rpc.close(); }
});

test('late unconsumed turns stay bounded and close clears buffers', async () => {
  const f = fixture(); await f.rpc.start();
  for (let i = 0; i < 200; i++) f.emit('turn/completed', { threadId: 'thread', turn: { id: String(i), status: 'completed' } });
  assert.ok(f.rpc.turnBuffers.size <= 64); f.rpc.close(); assert.equal(f.rpc.turnBuffers.size, 0);
});

test('oversized Codex frames fail pending turns and release retained output', async () => {
  const f = fixture(); await f.rpc.start();
  try {
    let failure; f.rpc.waitForTurn('thread', 'large').catch(error => { failure = error; });
    f.child.stdout.write('x'.repeat(8 * 1024 * 1024));
    await tick(); assert.equal(failure?.code, 'CODEX_OUTPUT_LIMIT');
    assert.equal(f.rpc.stdoutBuffer.length, 0); assert.equal(f.rpc.turnBuffers.size, 0);
  } finally { f.rpc.close(); }
});

test('Codex stderr keeps only bounded diagnostic context', async () => {
  const f = fixture(); await f.rpc.start();
  try { f.child.stderr.write('x'.repeat(1024 * 1024)); assert.ok(f.rpc.stderr.length <= 64 * 1024); }
  finally { f.rpc.close(); }
});
