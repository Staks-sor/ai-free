import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const jwt = exp => `header.${Buffer.from(JSON.stringify({ id: 'saved-user', exp })).toString('base64url')}.signature`;

for (const prefix of ['', 'plugin-for-vscode/']) {
  test(prefix + ' saved refresh session survives an expired access JWT and a new manager', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-session-restart-'));
    const previous = process.env.QWEN_ACCOUNTS_FILE;
    process.env.QWEN_ACCOUNTS_FILE = path.join(dir, 'accounts.json');
    t.after(() => {
      if (previous === undefined) delete process.env.QWEN_ACCOUNTS_FILE;
      else process.env.QWEN_ACCOUNTS_FILE = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const store = await import('../' + prefix + 'src/providers/qwen/account-store.mjs');
    const { createQwenAccountManager } = await import('../' + prefix + 'src/providers/qwen/account-manager.mjs');
    const account = { id: 'saved', primary: true, token: jwt(1), profileDir: dir,
      cookies: [{ name: 'refresh_token', value: 'saved-session', domain: '.qwen.ai', expires: Date.now() / 1000 + 86400 }] };
    store.saveAccounts([account]);
    const source = fs.readFileSync(new URL('../' + prefix + 'src/providers/registry.mjs', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('  qwen: {'), source.indexOf('  chatgpt: {'));
    const body = block.slice(block.indexOf('hasAuth: () => {') + 'hasAuth: () => {'.length, block.indexOf('\n    async login'));
    const context = vm.createContext({ hasAvailableAccounts: store.hasAvailableAccounts,
      hasRestorableQwenSession: store.hasRestorableQwenSession, readQwenAuth: () => null, QWEN_AUTH_FILE: 'unused', isQwenTokenExpired: store.isQwenTokenExpired });
    const configured = () => vm.runInContext('(function(){' + body.replace(/},\s*$/, '') + '})()', context);
    assert.equal(store.hasAvailableAccounts(), false, 'expired JWT must never be leased');
    assert.equal(configured(), true, 'composer must allow the worker to renew the saved session');
    const fresh = jwt(Math.floor(Date.now() / 1000) + 900);
    let refreshes = 0;
    const manager = createQwenAccountManager({ readLegacy: () => null, refreshOpenBrowser: async () => null,
      resetProxy: async () => {}, refreshProfile: async () => { refreshes++; return { ...account, token: fresh }; } });
    await manager.recoverUnavailable();
    assert.equal(store.hasAvailableAccounts(), true);
    assert.equal(createQwenAccountManager({ readLegacy: () => null }).list()[0].token, fresh);
    assert.equal(refreshes, 1);
    for (const changed of [{ ...account, disabled: true }, { ...account, cookies: [] },
      { ...account, cookies: [{ ...account.cookies[0], expires: 1 }] }]) {
      store.saveAccounts([changed]);
      assert.equal(configured(), false, 'absent, disabled or expired refresh sessions are not configured');
    }
    store.saveAccounts([]);
    context.readQwenAuth = () => account;
    assert.equal(configured(), true, 'the existing single-account profile can renew too');
  });
}
