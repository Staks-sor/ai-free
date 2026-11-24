import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createAccountActivity } from '../src/providers/account-activity.mjs';

const moduleUrl = new URL('../src/providers/account-activity.mjs', import.meta.url).href;
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-account-activity-'));
  return { root, activity: createAccountActivity({ root }) };
}
function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}
async function waitForFile(file) {
  for (let attempt = 0; attempt < 200 && !fs.existsSync(file); attempt += 1) await delay(10);
  assert.ok(fs.existsSync(file), `Timed out waiting for ${path.basename(file)}`);
}
function keyDir(root, provider, id) {
  const hash = createHash('sha256').update(provider).update('\0').update(id).digest('hex');
  return path.join(root, hash);
}

test('cross-process activity lease rejects a live owner as not sent', () => {
  const { root, activity } = setup();
  try {
    const release = activity.acquire('qwen', 'account-1');
    assert.equal(activity.isBusy('qwen', 'account-1', { otherProcessOnly: true }), false);
    const code = `import {createAccountActivity} from ${JSON.stringify(moduleUrl)};
      try { createAccountActivity({root:process.argv[1]}).acquire('qwen','account-1'); process.exitCode=2; }
      catch (error) { console.log(JSON.stringify({code:error.code,status:error.status,delivery:error.delivery})); }`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code, root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { code: 'ACCOUNT_BUSY', status: 409, delivery: 'not_sent' });
    assert.equal(activity.isBusy('qwen', 'account-1'), true);
    release();
    assert.equal(activity.isBusy('qwen', 'account-1'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('same-process nested leases refcount and an old release cannot clear a newer lease', () => {
  const { root, activity } = setup();
  try {
    const first = activity.acquire('deepseek', 'default');
    const second = activity.acquire('deepseek', 'default');
    first();
    assert.equal(activity.isBusy('deepseek', 'default'), true);
    first();
    second();
    assert.equal(activity.isBusy('deepseek', 'default'), false);

    const oldRelease = activity.acquire('deepseek', 'default');
    oldRelease();
    const newRelease = activity.acquire('deepseek', 'default');
    oldRelease();
    assert.equal(activity.isBusy('deepseek', 'default'), true);
    assert.equal(activity.isBusy('deepseek', 'default', { otherProcessOnly: true }), false);
    newRelease();
    assert.equal(activity.isBusy('deepseek', 'default'), false);
    const revisions = fs.readdirSync(keyDir(root, 'deepseek', 'default')).filter(name => name.endsWith('.json'));
    assert.ok(revisions.length <= 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('activity leases are independent for different stable account IDs', () => {
  const { root, activity } = setup();
  try {
    const releaseFirst = activity.acquire('glm', 'account-one');
    const releaseSecond = activity.acquire('glm', 'account-two');
    assert.equal(activity.isBusy('glm', 'account-one'), true);
    assert.equal(activity.isBusy('glm', 'account-two'), true);
    releaseFirst();
    assert.equal(activity.isBusy('glm', 'account-one'), false);
    assert.equal(activity.isBusy('glm', 'account-two'), true);
    releaseSecond();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SIGKILLed owner is reported idle and reclaimed by the next CAS', async () => {
  const { root, activity } = setup();
  const ready = path.join(root, 'owner-ready');
  const code = `import fs from 'node:fs';import {createAccountActivity} from ${JSON.stringify(moduleUrl)};
    createAccountActivity({root:process.argv[1]}).acquire('chatgpt','account-1');
    fs.writeFileSync(process.argv[2],'ready');setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, root, ready], { stdio: 'ignore' });
  try {
    await waitForFile(ready);
    assert.equal(activity.isBusy('chatgpt', 'account-1'), true);
    child.kill('SIGKILL');
    assert.equal((await waitForExit(child)).signal, 'SIGKILL');
    assert.equal(activity.isBusy('chatgpt', 'account-1'), false);

    const release = activity.acquire('chatgpt', 'account-1');
    assert.equal(activity.isBusy('chatgpt', 'account-1'), true);
    const files = fs.readdirSync(keyDir(root, 'chatgpt', 'account-1')).filter(name => name.endsWith('.json')).sort();
    assert.ok(files.length <= 2);
    const record = JSON.parse(fs.readFileSync(path.join(keyDir(root, 'chatgpt', 'account-1'), files.at(-1)), 'utf8'));
    assert.deepEqual(Object.keys(record.state.owner).sort(), ['count', 'instance', 'pid']);
    release();
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('malformed activity revisions fail closed and test defaults stay in memory', () => {
  const { root, activity } = setup();
  try {
    const dir = keyDir(root, 'qwen', 'broken');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '0000000000000001.json'), JSON.stringify({ version: 1, state: { owner: { pid: 'bad', instance: 'x', count: 1 } } }));
    assert.throws(() => activity.isBusy('qwen', 'broken'), error => error.code === 'ACCOUNT_ACTIVITY_CORRUPT');
    assert.throws(() => activity.acquire('qwen', 'broken'), error => error.code === 'ACCOUNT_ACTIVITY_CORRUPT');

    const inMemory = createAccountActivity();
    const release = inMemory.acquire('googleai', 'test-account');
    assert.equal(inMemory.isBusy('googleai', 'test-account'), true);
    release();
    assert.equal(inMemory.isBusy('googleai', 'test-account'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
