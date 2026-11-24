import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProviderAccountPool } from '../src/providers/account-pool.mjs';
import { createQwenAccountSession } from '../src/providers/qwen/account-session.mjs';

const runNode = promisify(execFile);

test('checkpoint history classifies a 200 unauthorized payload as expired auth', async () => {
  const source = new URL('../src/providers/qwen/client.mjs', import.meta.url).href;
  await runNode(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import assert from 'node:assert/strict';
    const source = ${JSON.stringify(source)};
    const stub = 'data:text/javascript,' + encodeURIComponent('export const getQwenBrowserProxy=async()=>globalThis.proxy; export const resetQwenBrowserProxy=async()=>{};');
    const code = fs.readFileSync(new URL(source), 'utf8').replace(/from "(\\.[^\"]+)"/g, (_, specifier) => 'from ' + JSON.stringify(specifier === './browser-proxy.mjs' ? stub : new URL(specifier, source).href));
    const { QwenChatClient } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    globalThis.proxy = { proxyApiGet: async () => ({ ok: true, status: 200, json: { success: false, data: { code: 'unauthorized', message: 'Token has expired' } } }) };
    const client = new QwenChatClient({ token: 'expired-test-token', cookieHeader: '' });
    await assert.rejects(client.recoverCheckpoint('saved-chat', { prompt: 'saved prompt', parentMessageId: 'parent' }), error => error.isQwenSessionExpired === true);
  `], { timeout: 15000 });
});

function sessionFixture({ refresh, read, signal, accountToken = 'old-token' }) {
  const accounts = [{ id: 'primary', primary: true, token: accountToken }];
  const pool = createProviderAccountPool();
  pool.register('qwen', { listAccounts: () => accounts });
  const builds = [], reads = [], refreshes = [];
  const session = createQwenAccountSession({ pool, affinityKey: 'checkpoint-recovery', signal,
    initial: { accountId: 'primary', chatId: 'saved-chat' },
    refreshAccount: async (...args) => {
      refreshes.push(args);
      const updated = await refresh?.(...args, accounts[0]);
      if (updated) accounts[0] = updated;
      return updated;
    },
    buildClient: async account => {
      builds.push({ id: account.id, token: account.token });
      return { recoverCheckpoint: async (chatId, checkpoint) => {
        reads.push({ chatId, prompt: checkpoint.prompt, token: account.token });
        return read({ chatId, checkpoint, account, reads });
      } };
    },
  });
  return { session, pool, accounts, builds, reads, refreshes };
}

test('expired history recovery refreshes and rereads the same checkpoint on the same account', async () => {
  const { session, pool, builds, reads, refreshes } = sessionFixture({
    refresh: async account => ({ ...account, token: 'new-token' }),
    read: ({ account }) => {
      if (account.token === 'old-token') throw Object.assign(new Error('expired'), { isQwenSessionExpired: true });
      return { text: 'recovered answer', lastMessageId: 'reply' };
    },
  });
  const result = await session.recoverCheckpoint('saved-chat', { prompt: 'saved prompt', parentMessageId: 'parent' });
  assert.equal(result.text, 'recovered answer');
  assert.deepEqual(builds.map(item => [item.id, item.token]), [['primary', 'old-token'], ['primary', 'new-token']]);
  assert.deepEqual(reads.map(item => [item.chatId, item.prompt]), [['saved-chat', 'saved prompt'], ['saved-chat', 'saved prompt']]);
  assert.equal(refreshes.length, 1);
  assert.equal(refreshes[0][0].id, 'primary');
  assert.deepEqual(refreshes[0][1], { resetBefore: true });
  assert.ok((await pool.snapshot('qwen')).every(account => !account.busy));
});

test('unchanged token and repeated auth failure stop after one refresh and release the lease', async () => {
  const { session, pool, reads, refreshes } = sessionFixture({
    refresh: async account => account,
    read: () => { throw Object.assign(new Error('expired again'), { isQwenSessionExpired: true }); },
  });
  await assert.rejects(session.recoverCheckpoint('saved-chat', { prompt: 'saved prompt' }), error => error.isQwenSessionExpired === true);
  assert.equal(reads.length, 1);
  assert.equal(refreshes.length, 1);
  assert.ok((await pool.snapshot('qwen')).every(account => !account.busy));
});

test('Stop during account refresh prevents a second history read and releases the lease', async () => {
  const controller = new AbortController();
  const { session, pool, reads, refreshes } = sessionFixture({
    signal: controller.signal,
    refresh: async account => { controller.abort(); return { ...account, token: 'new-token' }; },
    read: () => { throw Object.assign(new Error('expired'), { isQwenSessionExpired: true }); },
  });
  await assert.rejects(session.recoverCheckpoint('saved-chat', { prompt: 'saved prompt' }), error => error.name === 'AbortError');
  assert.equal(reads.length, 1);
  assert.equal(refreshes.length, 1);
  assert.ok((await pool.snapshot('qwen')).every(account => !account.busy));
});
