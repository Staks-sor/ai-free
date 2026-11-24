import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createAccountActivity } from '../src/providers/account-activity.mjs';
import { createWebAccountManager } from '../src/providers/web-account-manager.mjs';
import { createAccountRegistry } from '../src/providers/account-registry.mjs';
import { createProviderAccountPool } from '../src/providers/account-pool.mjs';
import { createQwenAccountManager } from '../src/providers/qwen/account-manager.mjs';

test('another process blocks dispatch and reconnect before touching its account', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-integration-'));
  const activityRoot = path.join(root, 'activity');
  const moduleUrl = new URL('../src/providers/account-activity.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import {createAccountActivity} from ${JSON.stringify(moduleUrl)};
    const release=createAccountActivity({root:${JSON.stringify(activityRoot)}}).acquire('glm','default');
    console.log('ready');process.stdin.once('data',()=>{release();process.exit(0);});
  `], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
    const activity = createAccountActivity({ root: activityRoot });
    const registry = createAccountRegistry({ root: path.join(root, 'accounts') });
    let logins = 0, sends = 0;
    const manager = createWebAccountManager({ registry, activity, adapters: { glm: {
      legacyPaths: { authFile: path.join(root, 'fixture.json') }, hasLegacy: () => true, hasAuth: () => true,
      close: async () => {}, login: async () => { logins++; }, buildClient: () => ({ complete: async () => { sends++; return 'ok'; } }),
    } } });
    const client = await manager.client('glm');
    await assert.rejects(client.complete(), e => e.code === 'ACCOUNT_BUSY');
    await assert.rejects(manager.action('glm', { action: 'login', id: 'default' }), e => e.code === 'ACCOUNT_BUSY');
    assert.equal(sends, 0); assert.equal(logins, 0);
    assert.equal((await manager.snapshot('glm')).accounts[0].status, 'busy');
    const pool = createProviderAccountPool({ activity });
    pool.register('glm', { listAccounts: async () => [{ id: 'default' }] });
    assert.equal(await pool.lease('glm'), null);
    assert.equal((await pool.snapshot('glm'))[0].busy, true);
    const done = new Promise(resolve => child.once('exit', resolve)); child.stdin.end('release'); await done;
    assert.equal(await client.complete(), 'ok');
    assert.equal(sends, 1); assert.equal(activity.isBusy('glm', 'default'), false);
  } finally { child.kill(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('Qwen refresh cannot read or reset a profile owned by another process', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-qwen-'));
  const activityRoot = path.join(root, 'activity');
  const moduleUrl = new URL('../src/providers/account-activity.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import {createAccountActivity} from ${JSON.stringify(moduleUrl)};
    const release=createAccountActivity({root:${JSON.stringify(activityRoot)}}).acquire('qwen','default');
    console.log('ready');process.stdin.once('data',()=>{release();process.exit(0);});
  `], { stdio: ['pipe', 'pipe', 'pipe'] });
  const previous = process.env.QWEN_ACCOUNTS_FILE;
  process.env.QWEN_ACCOUNTS_FILE = path.join(root, 'accounts.json');
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
    let reads = 0;
    const manager = createQwenAccountManager({ activity: createAccountActivity({ root: activityRoot }),
      readLegacy: () => { reads++; throw new Error('profile touched'); } });
    await assert.rejects(manager.refreshAccount('default'), e => e.code === 'ACCOUNT_BUSY');
    assert.equal(reads, 0);
    const done = new Promise(resolve => child.once('exit', resolve)); child.stdin.end('release'); await done;
  } finally {
    child.kill(); if (previous === undefined) delete process.env.QWEN_ACCOUNTS_FILE; else process.env.QWEN_ACCOUNTS_FILE = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
