import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbModule = path.join(root, 'src/memory/db.mjs');
const jsonOnlyNodeArgs = Number(process.versions.node.split('.')[0]) >= 22 ? ['--no-experimental-sqlite'] : [];

function startWriter(memoryDir, readyFile, startFile, count) {
  const code = `
    import fs from 'node:fs';
    import { warmMemoryBackend, insertMemoryItem } from ${JSON.stringify(dbModule)};
    await warmMemoryBackend();
    fs.writeFileSync(${JSON.stringify(readyFile)}, 'ready');
    while (!fs.existsSync(${JSON.stringify(startFile)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    for (let i = 0; i < ${count}; i += 1) insertMemoryItem({ id: process.pid + '-' + i, content: 'writer entry ' + i });
  `;
  const child = spawn(process.execPath, [...jsonOnlyNodeArgs, '--input-type=module', '-e', code], {
    env: { ...process.env, AI_FREE_MEMORY_DIR: memoryDir, NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  return { child, output: () => output };
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

test('JSON fallback merges concurrent process inserts from the latest disk state', async () => {
  const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-json-memory-'));
  let first, second;
  try {
    const startFile = path.join(memoryDir, 'start');
    first = startWriter(memoryDir, path.join(memoryDir, 'first.ready'), startFile, 12);
    second = startWriter(memoryDir, path.join(memoryDir, 'second.ready'), startFile, 12);
    for (let i = 0; i < 200 && (!fs.existsSync(path.join(memoryDir, 'first.ready')) || !fs.existsSync(path.join(memoryDir, 'second.ready'))); i += 1) await delay(10);
    assert.ok(fs.existsSync(path.join(memoryDir, 'first.ready')) && fs.existsSync(path.join(memoryDir, 'second.ready')), `${first.output()}${second.output()}`);
    fs.writeFileSync(startFile, 'go');
    const results = await Promise.all([waitForExit(first.child), waitForExit(second.child)]);
    assert.deepEqual(results.map(result => result.code), [0, 0], `${first.output()}${second.output()}`);
    const index = JSON.parse(fs.readFileSync(path.join(memoryDir, 'index.json'), 'utf8'));
    assert.equal(index.items.length, 24);
  } finally {
    if (first?.child.exitCode === null) first.child.kill();
    if (second?.child.exitCode === null) second.child.kill();
    fs.rmSync(memoryDir, { recursive: true, force: true });
  }
});

test('JSON fallback refuses to replace a corrupted index', async () => {
  const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-json-memory-corrupt-'));
  const indexPath = path.join(memoryDir, 'index.json');
  const corrupt = '{broken json';
  try {
    fs.writeFileSync(indexPath, corrupt);
    const code = `import { insertMemoryItem } from ${JSON.stringify(dbModule)}; insertMemoryItem({ id: 'replacement' });`;
    const child = spawn(process.execPath, [...jsonOnlyNodeArgs, '--input-type=module', '-e', code], {
      env: { ...process.env, AI_FREE_MEMORY_DIR: memoryDir, NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = await waitForExit(child);
    assert.notEqual(result.code, 0);
    assert.equal(fs.readFileSync(indexPath, 'utf8'), corrupt);
  } finally {
    fs.rmSync(memoryDir, { recursive: true, force: true });
  }
});

test('JSON fallback delete is preserved when another cached process inserts afterward', async () => {
  const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-json-memory-delete-'));
  const seedCode = `import { insertMemoryItem } from ${JSON.stringify(dbModule)}; insertMemoryItem({ id: 'remove-me', content: 'old' });`;
  const seed = spawn(process.execPath, [...jsonOnlyNodeArgs, '--input-type=module', '-e', seedCode], {
    env: { ...process.env, AI_FREE_MEMORY_DIR: memoryDir, NODE_NO_WARNINGS: '1' },
    stdio: 'ignore',
  });
  await waitForExit(seed);

  const startFile = path.join(memoryDir, 'start-delete');
  const deletedFile = path.join(memoryDir, 'deleted');
  const writerCode = `
    import fs from 'node:fs';
    import { warmMemoryBackend, insertMemoryItem } from ${JSON.stringify(dbModule)};
    await warmMemoryBackend();
    fs.writeFileSync(${JSON.stringify(path.join(memoryDir, 'writer.ready'))}, 'ready');
    while (!fs.existsSync(${JSON.stringify(startFile)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    while (!fs.existsSync(${JSON.stringify(deletedFile)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    insertMemoryItem({ id: 'new-entry', content: 'new' });
  `;
  const deleterCode = `
    import fs from 'node:fs';
    import { warmMemoryBackend, deleteMemoryItem } from ${JSON.stringify(dbModule)};
    await warmMemoryBackend();
    fs.writeFileSync(${JSON.stringify(path.join(memoryDir, 'deleter.ready'))}, 'ready');
    while (!fs.existsSync(${JSON.stringify(startFile)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    deleteMemoryItem('remove-me');
    fs.writeFileSync(${JSON.stringify(deletedFile)}, 'done');
  `;
  const env = { ...process.env, AI_FREE_MEMORY_DIR: memoryDir, NODE_NO_WARNINGS: '1' };
  const writer = spawn(process.execPath, [...jsonOnlyNodeArgs, '--input-type=module', '-e', writerCode], { env, stdio: 'ignore' });
  const deleter = spawn(process.execPath, [...jsonOnlyNodeArgs, '--input-type=module', '-e', deleterCode], { env, stdio: 'ignore' });
  try {
    for (let i = 0; i < 200 && (!fs.existsSync(path.join(memoryDir, 'writer.ready')) || !fs.existsSync(path.join(memoryDir, 'deleter.ready'))); i += 1) await delay(10);
    assert.ok(fs.existsSync(path.join(memoryDir, 'writer.ready')) && fs.existsSync(path.join(memoryDir, 'deleter.ready')));
    fs.writeFileSync(startFile, 'go');
    const results = await Promise.all([waitForExit(writer), waitForExit(deleter)]);
    assert.deepEqual(results.map(result => result.code), [0, 0]);
    const index = JSON.parse(fs.readFileSync(path.join(memoryDir, 'index.json'), 'utf8'));
    assert.deepEqual(index.items.map(item => item.id), ['new-entry']);
  } finally {
    if (writer.exitCode === null) writer.kill();
    if (deleter.exitCode === null) deleter.kill();
    fs.rmSync(memoryDir, { recursive: true, force: true });
  }
});

test('JSON fallback recovers a killed lock owner without losing concurrent contender writes', async () => {
  const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-json-memory-killed-'));
  const lockReady = path.join(memoryDir, 'owner-ready');
  const ownerCode = `
    import fs from 'node:fs';
    import { insertMemoryItem } from ${JSON.stringify(dbModule)};
    const sync = fs.fsyncSync.bind(fs);
    fs.fsyncSync = fd => { sync(fd); fs.writeFileSync(${JSON.stringify(lockReady)}, 'ready'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); };
    insertMemoryItem({ id: 'killed-write', content: 'not yet published' });
  `;
  const owner = spawn(process.execPath, [...jsonOnlyNodeArgs, '--input-type=module', '-e', ownerCode], {
    env: { ...process.env, AI_FREE_MEMORY_DIR: memoryDir, NODE_NO_WARNINGS: '1' },
    stdio: 'ignore',
  });
  let first, second;
  try {
    for (let i = 0; i < 200 && !fs.existsSync(lockReady); i += 1) await delay(10);
    assert.ok(fs.existsSync(lockReady), 'lock owner reached atomic write while holding the lock');
    owner.kill('SIGKILL');
    const ownerExit = await waitForExit(owner);
    assert.equal(ownerExit.signal, 'SIGKILL');

    const startFile = path.join(memoryDir, 'start-recovery');
    first = startWriter(memoryDir, path.join(memoryDir, 'first-recovery.ready'), startFile, 10);
    second = startWriter(memoryDir, path.join(memoryDir, 'second-recovery.ready'), startFile, 10);
    for (let i = 0; i < 200 && (!fs.existsSync(path.join(memoryDir, 'first-recovery.ready')) || !fs.existsSync(path.join(memoryDir, 'second-recovery.ready'))); i += 1) await delay(10);
    assert.ok(fs.existsSync(path.join(memoryDir, 'first-recovery.ready')) && fs.existsSync(path.join(memoryDir, 'second-recovery.ready')));
    fs.writeFileSync(startFile, 'go');
    const results = await Promise.all([waitForExit(first.child), waitForExit(second.child)]);
    assert.deepEqual(results.map(result => result.code), [0, 0], `${first.output()}${second.output()}`);
    const index = JSON.parse(fs.readFileSync(path.join(memoryDir, 'index.json'), 'utf8'));
    assert.equal(index.items.length, 20);
    assert.ok(!index.items.some(item => item.id === 'killed-write'));
  } finally {
    if (owner.exitCode === null) owner.kill('SIGKILL');
    if (first?.child.exitCode === null) first.child.kill();
    if (second?.child.exitCode === null) second.child.kill();
    fs.rmSync(memoryDir, { recursive: true, force: true });
  }
});

test('JSON fallback never publishes an ownerless canonical lock during initialization', async () => {
  const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-free-json-memory-init-'));
  const lockPath = path.join(memoryDir, 'index.json.lock');
  const readyFile = path.join(memoryDir, 'owner-staged');
  const continueFile = path.join(memoryDir, 'publish-owner');
  const ownerCode = `
    import fs from 'node:fs';
    const rename = fs.renameSync.bind(fs);
    fs.renameSync = (from, to) => {
      if (String(to).endsWith('owner.json')) {
        fs.writeFileSync(${JSON.stringify(readyFile)}, 'ready');
        while (!fs.existsSync(${JSON.stringify(continueFile)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
      return rename(from, to);
    };
    const { insertMemoryItem } = await import(${JSON.stringify(dbModule)});
    insertMemoryItem({ id: 'staged-owner', content: 'first' });
  `;
  const contenderCode = `import { insertMemoryItem } from ${JSON.stringify(dbModule)}; insertMemoryItem({ id: 'contender', content: 'second' });`;
  const env = { ...process.env, AI_FREE_MEMORY_DIR: memoryDir, NODE_NO_WARNINGS: '1' };
  const owner = spawn(process.execPath, [...jsonOnlyNodeArgs, '--input-type=module', '-e', ownerCode], { env, stdio: 'ignore' });
  let contender;
  try {
    for (let i = 0; i < 200 && !fs.existsSync(readyFile); i += 1) await delay(10);
    assert.ok(fs.existsSync(readyFile), 'owner paused before publishing its prepared lock');
    if (fs.existsSync(lockPath)) {
      let ownerRecord;
      try { ownerRecord = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8')); } catch {}
      assert.ok(ownerRecord && Number.isSafeInteger(ownerRecord.pid) && typeof ownerRecord.token === 'string',
        'a visible canonical lock always contains its complete owner record');
    }

    contender = spawn(process.execPath, [...jsonOnlyNodeArgs, '--input-type=module', '-e', contenderCode], { env, stdio: 'ignore' });
    await delay(30);
    fs.writeFileSync(continueFile, 'go');
    const results = await Promise.all([waitForExit(owner), waitForExit(contender)]);
    assert.deepEqual(results.map(result => result.code), [0, 0]);
    const index = JSON.parse(fs.readFileSync(path.join(memoryDir, 'index.json'), 'utf8'));
    assert.deepEqual(index.items.map(item => item.id).sort(), ['contender', 'staged-owner']);
  } finally {
    fs.writeFileSync(continueFile, 'go');
    if (owner.exitCode === null) owner.kill();
    if (contender?.exitCode === null) contender.kill();
    fs.rmSync(memoryDir, { recursive: true, force: true });
  }
});
