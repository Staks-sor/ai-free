import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createQwenAccountManager, selectQwenReconnectAccount, formatQwenSwitchNotice, isSameQwenIdentity } from '../src/providers/qwen/account-manager.mjs';
import { alignQwenAuthInContext, waitForQwenToken } from '../src/providers/qwen/browser-login.mjs';

test('Qwen persists the captured login token in browser cookies and localStorage', async () => {
  const values = [];
  const cookies = [];
  const context = {
    addCookies: async entries => cookies.push(...entries),
    pages: () => [
      { url: () => 'https://chat.qwen.ai/', evaluate: async (_, value) => values.push(value) },
      { url: () => 'https://accounts.google.com/', evaluate: async () => { throw new Error('OAuth page must not be touched'); } },
    ],
  };
  await alignQwenAuthInContext(context, { token: 'fresh', cookies: [{ name: 'token', value: 'old', domain: '.qwen.ai', path: '/' }] });
  assert.equal(cookies.find(cookie => cookie.name === 'token')?.value, 'fresh');
  assert.deepEqual(values, ['fresh']);
});
import { renderWindowHtml } from '../src/window-app/ui-html.mjs';
import { createProviderAccountPool } from '../src/providers/account-pool.mjs';

test('network renewal failure does not become a login request on the next attempt', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-renewal-offline-'));
  const previous = process.env.QWEN_ACCOUNTS_FILE;
  process.env.QWEN_ACCOUNTS_FILE = path.join(dir, 'accounts.json');
  t.after(() => {
    if (previous === undefined) delete process.env.QWEN_ACCOUNTS_FILE;
    else process.env.QWEN_ACCOUNTS_FILE = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.writeFileSync(process.env.QWEN_ACCOUNTS_FILE, JSON.stringify([{ id: 'saved', primary: true,
    token: `header.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.signature`, profileDir: dir }]));
  const failure = Object.assign(new Error('Qwen temporarily unavailable'), { code: 'QWEN_SESSION_REFRESH_UNAVAILABLE' });
  let refreshes = 0, failRefresh;
  const pending = new Promise((_, reject) => { failRefresh = reject; });
  const manager = createQwenAccountManager({ readLegacy: () => null, refreshOpenBrowser: async () => null,
    refreshProfile: async () => { refreshes++; return pending; } });
  const first = manager.recoverUnavailable();
  const second = manager.recoverUnavailable();
  const checks = [assert.rejects(first, error => error === failure), assert.rejects(second, error => error === failure)];
  failRefresh(failure);
  await Promise.all(checks);
  await assert.rejects(manager.recoverUnavailable(), error => error === failure);
  assert.equal(refreshes, 1, 'backoff must preserve the transport failure instead of starting login');
  assert.notEqual(manager.list()[0].invalid, true);
});

test('Qwen login accepts a JWT in localStorage when the cookie token is absent', async () => {
  const jwt = ['header', 'payload', 'signature'].join('.');
  const context = { cookies: async () => [{ name: 'refresh_token', value: 'private', domain: '.qwen.ai' }] };
  const page = { evaluate: async () => jwt };
  const result = await waitForQwenToken(context, { page, timeoutMs: 100 });
  assert.equal(result.token, jwt);
});

test('Qwen login prefers a fresh token from the active Qwen tab over an expired cookie or stale first tab', async () => {
  const token = exp => ['header', Buffer.from(JSON.stringify({ exp })).toString('base64url'), 'signature'].join('.');
  const expired = token(Math.floor(Date.now() / 1000) - 60);
  const fresh = token(Math.floor(Date.now() / 1000) + 3600);
  const stalePage = { url: () => 'https://accounts.google.com/', evaluate: async () => token(Math.floor(Date.now() / 1000) + 7200) };
  const qwenPage = { url: () => 'https://chat.qwen.ai/', evaluate: async () => fresh };
  const context = { cookies: async () => [{ name: 'token', value: expired, domain: '.qwen.ai' }], pages: () => [stalePage, qwenPage] };
  const result = await waitForQwenToken(context, { page: stalePage, intervalMs: 1, timeoutMs: 100 });
  assert.equal(result.token, fresh);
  assert.equal(result.cookies.find(cookie => cookie.name === 'token')?.value, fresh);
});

test('Qwen reconnect waits for a replacement token instead of accepting the saved live JWT', async () => {
  const token = issued => ['header', Buffer.from(JSON.stringify({ iat: issued, exp: 9999999999 })).toString('base64url'), 'signature'].join('.');
  const old = token(1), fresh = token(2);
  let reads = 0;
  const page = { url: () => 'https://chat.qwen.ai/', evaluate: async () => ++reads < 2 ? old : fresh };
  const context = { cookies: async () => [{ name: 'token', value: old, domain: '.qwen.ai' }], pages: () => [page] };
  const result = await waitForQwenToken(context, { page, previousToken: old, intervalMs: 1, timeoutMs: 100 });
  assert.equal(result.token, fresh);
  assert.equal(reads, 2);
});

test('reconnecting Qwen does not erase a browser session before inspecting its token', () => {
  for (const file of ['src/providers/qwen/account-manager.mjs', 'plugin-for-vscode/src/providers/qwen/account-manager.mjs']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /clearSession: Boolean\(existing\)/);
  }
});

test('general Qwen connect reuses the existing primary profile instead of creating a new one', () => {
  const accounts = [{ id: 'acc_1', primary: true, invalid: true }, { id: 'acc_2' }];
  assert.equal(selectQwenReconnectAccount(accounts).id, 'acc_1');
  assert.equal(selectQwenReconnectAccount(accounts, ['acc_2']).id, 'acc_2');
  assert.equal(selectQwenReconnectAccount([{ id: 'acc_2' }]).id, 'acc_2');
  assert.equal(selectQwenReconnectAccount([]), null);
  for (const file of ['src/window-app/server.mjs', 'plugin-for-vscode/src/window-app/server.mjs']) {
    assert.match(fs.readFileSync(file, 'utf8'), /selectQwenReconnectAccount\(qwenAccounts\.list\(\), \[activeQwenChat\?\.qwenAccountId, activeQwenChat\?\.qwenCodeAccountId\]\)/);
  }
});

test('Qwen reconnect prefers an invalid account pinned to the current chat over a ready primary', () => {
  const accounts = [{ id: 'acc_1', primary: true }, { id: 'acc_2', invalid: true }];
  assert.equal(selectQwenReconnectAccount(accounts, ['acc_2']).id, 'acc_2');
  assert.equal(selectQwenReconnectAccount(accounts, ['acc_1', 'acc_2']).id, 'acc_2');
  assert.equal(selectQwenReconnectAccount(accounts, ['removed']).id, 'acc_1');
});

test('general reconnect targets the healthy canonical profile when the pinned record is its duplicate', () => {
  const token = issued => ['header', Buffer.from(JSON.stringify({ id: 'same-person', iat: issued })).toString('base64url'), 'signature'].join('.');
  const accounts = [{ id: 'first', primary: true, token: token(1) }, { id: 'duplicate', invalid: true, token: token(2) }];
  assert.equal(selectQwenReconnectAccount(accounts, ['duplicate']).id, 'first');
});

test('two Qwen browser profiles are equivalent only with the same stable JWT identity', () => {
  const token = id => ['header', Buffer.from(JSON.stringify({ id, exp: 9999999999 })).toString('base64url'), 'signature'].join('.');
  assert.equal(isSameQwenIdentity({ token: token('person-a') }, { token: token('person-a') }), true);
  assert.equal(isSameQwenIdentity({ token: token('person-a') }, { token: token('person-b') }), false);
  assert.equal(isSameQwenIdentity({ token: 'not-a-jwt' }, { token: token('person-a') }), false);
});

test('Qwen rejects a second profile for the same user and rejects a different user on reconnect', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-identity-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  process.env.QWEN_ACCOUNTS_FILE = path.join(directory, 'accounts.json');
  t.after(() => delete process.env.QWEN_ACCOUNTS_FILE);
  const token = (id, issued) => ['header', Buffer.from(JSON.stringify({ id, iat: issued, exp: 9999999999 })).toString('base64url'), 'signature'].join('.');
  fs.writeFileSync(process.env.QWEN_ACCOUNTS_FILE, JSON.stringify([{ id: 'saved', token: token('person-a', 1), profileDir: directory }]));
  let next = token('person-a', 2);
  const manager = createQwenAccountManager({ readLegacy: () => null, prepareLogin: async () => {},
    login: async () => ({ token: next, cookies: [], userId: '' }) });
  await manager.action({ action: 'login' });
  await manager.waitForLogin();
  assert.equal((await manager.snapshot()).login.state, 'failed');
  assert.equal(manager.list().length, 1);
  next = token('person-b', 3);
  await manager.action({ action: 'login', id: 'saved' });
  await manager.waitForLogin();
  assert.equal((await manager.snapshot()).login.state, 'failed');
  assert.equal(manager.list()[0].token, token('person-a', 1));
});

test('reconnecting the primary Qwen user succeeds despite an older duplicate profile', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-reconnect-duplicate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  process.env.QWEN_ACCOUNTS_FILE = path.join(directory, 'accounts.json');
  t.after(() => delete process.env.QWEN_ACCOUNTS_FILE);
  const token = issued => ['header', Buffer.from(JSON.stringify({ id: 'same-person', iat: issued, exp: 9999999999 })).toString('base64url'), 'signature'].join('.');
  fs.writeFileSync(process.env.QWEN_ACCOUNTS_FILE, JSON.stringify([
    { id: 'primary', token: token(1), invalid: true, primary: true },
    { id: 'old-duplicate', token: token(2), invalid: true },
  ]));
  const manager = createQwenAccountManager({ readLegacy: () => null, prepareLogin: async () => {},
    login: async () => ({ token: token(3), cookies: [], userId: '' }) });
  await manager.action({ action: 'login', id: 'primary' });
  await manager.waitForLogin();
  assert.equal((await manager.snapshot()).login.state, 'done');
  assert.equal(manager.list()[0].token, token(3));
  assert.equal(manager.list()[0].invalid, false);
  assert.equal(manager.list()[1].token, token(2));
});

test('existing duplicate Qwen profiles are labelled rather than shown as two usable accounts', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-duplicate-status-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  process.env.QWEN_ACCOUNTS_FILE = path.join(directory, 'accounts.json');
  t.after(() => delete process.env.QWEN_ACCOUNTS_FILE);
  const token = issued => ['header', Buffer.from(JSON.stringify({ id: 'same-person', iat: issued })).toString('base64url'), 'signature'].join('.');
  fs.writeFileSync(process.env.QWEN_ACCOUNTS_FILE, JSON.stringify([
    { id: 'first', token: token(1), primary: true }, { id: 'second', token: token(2), invalid: true },
  ]));
  const snapshot = await createQwenAccountManager({ readLegacy: () => null }).snapshot();
  assert.equal(snapshot.accounts[1].status, 'duplicate');
  assert.equal(snapshot.accounts[1].duplicateOf, 1);
  assert.match(renderWindowHtml({ language: 'ru' }), /Дубликат Qwen-пользователя/);
});

test('an expired saved Qwen JWT is not reported ready or selected as a healthy duplicate', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-expired-status-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  process.env.QWEN_ACCOUNTS_FILE = path.join(directory, 'accounts.json');
  t.after(() => delete process.env.QWEN_ACCOUNTS_FILE);
  const token = exp => ['header', Buffer.from(JSON.stringify({ id: 'same-person', exp })).toString('base64url'), 'signature'].join('.');
  const accounts = [{ id: 'first', primary: true, token: token(Math.floor(Date.now() / 1000) - 60) },
    { id: 'duplicate', invalid: true, token: token(Math.floor(Date.now() / 1000) - 120) }];
  fs.writeFileSync(process.env.QWEN_ACCOUNTS_FILE, JSON.stringify(accounts));
  assert.equal((await createQwenAccountManager({ readLegacy: () => null }).snapshot()).accounts[0].status, 'invalid');
  assert.equal(selectQwenReconnectAccount(accounts, ['duplicate']).id, 'duplicate');
});

test('Qwen recovers an expired account from its browser profile before reporting no accounts', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-expired-recovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  process.env.QWEN_ACCOUNTS_FILE = path.join(directory, 'accounts.json');
  t.after(() => delete process.env.QWEN_ACCOUNTS_FILE);
  const token = exp => ['header', Buffer.from(JSON.stringify({ id: 'same-person', exp })).toString('base64url'), 'signature'].join('.');
  const expired = token(Math.floor(Date.now() / 1000) - 60);
  const fresh = token(Math.floor(Date.now() / 1000) + 3600);
  fs.writeFileSync(process.env.QWEN_ACCOUNTS_FILE, JSON.stringify([{ id: 'primary', primary: true, token: expired, profileDir: directory }]));
  let refreshes = 0;
  const manager = createQwenAccountManager({ readLegacy: () => null, resetProxy: async () => {},
    refreshProfile: async () => { refreshes++; return { token: fresh, cookies: [], cookieHeader: '' }; } });
  const pool = createProviderAccountPool();
  pool.register('qwen', { listAccounts: manager.routingAccounts });
  assert.equal(await pool.lease('qwen'), null);
  await manager.recoverUnavailable();
  const lease = await pool.lease('qwen');
  assert.equal(lease?.account.id, 'primary');
  lease.release();
  assert.equal(refreshes, 1);
});

test('routing uses one healthy profile per Qwen user and labels primary, additional and duplicate separately', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-account-roles-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  process.env.QWEN_ACCOUNTS_FILE = path.join(directory, 'accounts.json');
  t.after(() => delete process.env.QWEN_ACCOUNTS_FILE);
  const token = (id, exp) => ['header', Buffer.from(JSON.stringify({ id, exp })).toString('base64url'), 'signature'].join('.');
  const past = Math.floor(Date.now() / 1000) - 60;
  const future = Math.floor(Date.now() / 1000) + 3600;
  fs.writeFileSync(process.env.QWEN_ACCOUNTS_FILE, JSON.stringify([
    { id: 'old-primary', primary: true, token: token('person-a', past) },
    { id: 'fresh-same-user', token: token('person-a', future) },
    { id: 'other-user', token: token('person-b', future) },
  ]));
  const manager = createQwenAccountManager({ readLegacy: () => null });
  const snapshot = await manager.snapshot();
  assert.deepEqual(snapshot.accounts.map(account => [account.role, account.status, account.duplicateOf]), [
    ['duplicate', 'duplicate', 2], ['primary', 'ready', null], ['additional', 'ready', null],
  ]);
  const routing = manager.routingAccounts();
  assert.equal(routing.find(account => account.id === 'old-primary').disabled, true);
  assert.equal(routing.find(account => account.id === 'fresh-same-user').primary, true);
  assert.equal(routing.find(account => account.id === 'other-user').primary, false);
  const pool = createProviderAccountPool();
  pool.register('qwen', { listAccounts: manager.routingAccounts });
  const lease = await pool.lease('qwen', { preferredId: 'old-primary' });
  assert.equal(lease.account.id, 'fresh-same-user');
  lease.release();
  await assert.rejects(manager.action({ action: 'primary', id: 'old-primary' }), /duplicate/i);
  await manager.action({ action: 'primary', id: 'other-user' });
  assert.equal((await manager.snapshot()).accounts[2].role, 'primary');
  for (const file of ['src/window-app/server.mjs', 'plugin-for-vscode/src/window-app/server.mjs']) {
    assert.match(fs.readFileSync(file, 'utf8'), /listAccounts: \(\) => qwenAccounts\.routingAccounts\(\)/);
  }
});

test('Qwen quota handoff notice uses account labels, never internal installation IDs', () => {
  const accounts = [{ id: 'acc_old' }, { id: 'acc_new', label: 'Рабочий' }];
  const notice = formatQwenSwitchNotice(accounts, { from: 'acc_old', to: 'acc_new' });
  assert.match(notice, /лимит/i);
  assert.match(notice, /Рабочий/);
  assert.doesNotMatch(notice, /acc_old|acc_new/);
});

test('Qwen login ignores an expired JWT left in the browser profile', async () => {
  const expired = ['header', Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })).toString('base64url'), 'signature'].join('.');
  const fresh = ['header', Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'signature'].join('.');
  let reads = 0;
  const context = { cookies: async () => [{ name: 'refresh_token', value: 'private', domain: '.qwen.ai' }] };
  const page = { evaluate: async () => (++reads < 2 ? expired : fresh) };
  const result = await waitForQwenToken(context, { page, intervalMs: 1, timeoutMs: 100 });
  assert.equal(result.token, fresh);
  assert.ok(reads >= 2);
});

test('account login reports a safe timeout reason instead of hiding it', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-manager-error-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  process.env.QWEN_ACCOUNTS_FILE = path.join(directory, 'accounts.json');
  t.after(() => delete process.env.QWEN_ACCOUNTS_FILE);
  const manager = createQwenAccountManager({
    readLegacy: () => null,
    prepareLogin: async () => {},
    login: async () => { throw new Error('Qwen login timeout (300s). Не дождались валидного JWT в куках. Попробуй снова.'); },
  });
  await manager.action({ action: 'login' });
  await manager.waitForLogin();
  const snapshot = await manager.snapshot();
  assert.equal(snapshot.login.state, 'failed');
  assert.match(snapshot.login.error, /300s|JWT/);
  assert.equal(snapshot.accounts.length, 0);
});

test('account management persists preferences, redacts credentials and adds isolated login', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-manager-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  process.env.QWEN_ACCOUNTS_FILE = path.join(directory, 'accounts.json');
  t.after(() => delete process.env.QWEN_ACCOUNTS_FILE);
  const manager = createQwenAccountManager({ readLegacy: () => null, prepareLogin: async () => {}, login: async () => ({ token: 'SECRET', cookies: ['PRIVATE'], userId: 'user-a' }) });
  assert.equal((await manager.snapshot()).accounts.length, 0);
  await manager.action({ action: 'login' });
  await manager.waitForLogin();
  const snapshot = await manager.snapshot();
  assert.equal(snapshot.login.state, 'done');
  assert.equal(snapshot.accounts.length, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET|PRIVATE|token|cookies|user-a/);
  const id = snapshot.accounts[0].id;
  await manager.action({ action: 'disable', id, disabled: true });
  assert.equal((await manager.snapshot()).accounts[0].status, 'disabled');
  await manager.action({ action: 'autoSwitch', enabled: false });
  assert.equal(manager.autoSwitch(), false);
  manager.markLimited(id);
  await manager.action({ action: 'retry', id });
  assert.equal(manager.list()[0].limited, false);
  fs.writeFileSync(process.env.QWEN_ACCOUNTS_FILE + '.settings', '{');
  assert.equal(manager.autoSwitch(), false, 'malformed preferences fail closed without crashing');
  await assert.rejects(manager.action({ action: 'primary', id: '../other' }));
  await manager.action({ action: 'login' });
  await manager.waitForLogin();
  assert.equal((await manager.snapshot()).accounts.length, 1, 'same provider user cannot double the pool');
});


test('refreshAccount updates cookies and token from the saved profile before reuse', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-manager-refresh-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const accountsFile = path.join(directory, 'accounts.json');
  const profileDir = path.join(directory, 'browser-profile-a');
  process.env.QWEN_ACCOUNTS_FILE = accountsFile;
  t.after(() => delete process.env.QWEN_ACCOUNTS_FILE);
  fs.writeFileSync(accountsFile, JSON.stringify([{ id: 'a', token: 'old', cookieHeader: 'token=old', limited: true, invalid: true, profileDir }]));

  const refreshedFiles = [];
  const resetIds = [];
  const manager = createQwenAccountManager({
    readLegacy: () => null,
    refreshProfile: async file => {
      refreshedFiles.push(file);
      return { token: 'fresh', cookieHeader: 'token=fresh; x=1', cookies: [{ name: 'token', value: 'fresh' }], userId: 'user-a' };
    },
    resetProxy: async id => { resetIds.push(id); },
  });

  const refreshed = await manager.refreshAccount('a');
  assert.equal(refreshed.token, 'fresh');
  assert.equal(refreshed.cookieHeader, 'token=fresh; x=1');
  assert.equal(refreshed.limited, false);
  assert.equal(refreshed.invalid, false);
  assert.deepEqual(refreshedFiles, [path.join(profileDir, 'auth.json')]);
  assert.deepEqual(resetIds, ['a']);
});

test('Qwen ignores an expired reply from an older request after login saved a newer token', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-stale-reply-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  process.env.QWEN_ACCOUNTS_FILE = path.join(directory, 'accounts.json');
  t.after(() => delete process.env.QWEN_ACCOUNTS_FILE);
  fs.writeFileSync(process.env.QWEN_ACCOUNTS_FILE, JSON.stringify([{ id: 'a', token: 'fresh', profileDir: directory }]));
  let refreshes = 0, resets = 0;
  const manager = createQwenAccountManager({ readLegacy: () => null,
    refreshProfile: async () => { refreshes++; throw new Error('must not refresh stale profile'); },
    resetProxy: async () => { resets++; },
  });
  const current = await manager.refreshAccount({ id: 'a', token: 'old' }, { resetBefore: true });
  assert.equal(current.token, 'fresh');
  assert.equal(current.invalid, undefined);
  assert.equal(refreshes, 0);
  assert.equal(resets, 1);
});

test('auth recovery closes the active Qwen profile before opening it for silent refresh', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-auth-recovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  process.env.QWEN_ACCOUNTS_FILE = path.join(directory, 'accounts.json');
  t.after(() => delete process.env.QWEN_ACCOUNTS_FILE);
  fs.writeFileSync(process.env.QWEN_ACCOUNTS_FILE, JSON.stringify([{ id: 'a', token: 'old', profileDir: path.join(directory, 'profile') }]));
  const order = [];
  const manager = createQwenAccountManager({
    readLegacy: () => null,
    resetProxy: async () => { order.push('close'); },
    refreshProfile: async () => {
      order.push('refresh');
      return { token: 'fresh', cookies: [], cookieHeader: '', userId: '' };
    },
  });
  await manager.refreshAccount('a', { resetBefore: true });
  assert.deepEqual(order, ['close', 'refresh', 'close']);
});

test('Qwen rejects an eleventh account before opening a browser and allows reconnect', async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qwen-limit-'));
  process.env.QWEN_ACCOUNTS_FILE=path.join(directory,'accounts.json');
  t.after(()=>{delete process.env.QWEN_ACCOUNTS_FILE;fs.rmSync(directory,{recursive:true,force:true});});
  fs.writeFileSync(process.env.QWEN_ACCOUNTS_FILE,JSON.stringify(Array.from({length:10},(_,n)=>({id:'a'+n,token:'token'+n,userId:'u'+n,profileDir:directory}))));
  let logins=0;const manager=createQwenAccountManager({readLegacy:()=>null,prepareLogin:async()=>{},login:async()=>{logins++;return {token:'token0',userId:'u0'};}});
  await assert.rejects(manager.action({action:'login'}),/10 аккаунтов/);assert.equal(logins,0);
  await manager.action({action:'login',id:'a0'});await manager.waitForLogin();assert.equal(logins,1);assert.equal(manager.list().length,10);
});
test('Qwen account label survives a fresh manager and does not expose credentials', async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qwen-label-'));
  process.env.QWEN_ACCOUNTS_FILE=path.join(directory,'accounts.json');
  t.after(()=>{delete process.env.QWEN_ACCOUNTS_FILE;fs.rmSync(directory,{recursive:true,force:true});});
  fs.writeFileSync(process.env.QWEN_ACCOUNTS_FILE,JSON.stringify([{id:'a',token:'private',userId:'user'}]));
  const manager=createQwenAccountManager({readLegacy:()=>null});await manager.action({action:'rename',id:'a',label:'Рабочий'});
  const snapshot=await createQwenAccountManager({readLegacy:()=>null}).snapshot();assert.equal(snapshot.accounts[0].label,'Рабочий');assert.doesNotMatch(JSON.stringify(snapshot),/private|userId|cookie/);
});

test('connecting a saved Qwen account tries silent renewal before visible login', async t => {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qwen-connect-silent-'));
 const previous=process.env.QWEN_ACCOUNTS_FILE;
 process.env.QWEN_ACCOUNTS_FILE=path.join(directory,'accounts.json');
 t.after(()=>{if(previous===undefined)delete process.env.QWEN_ACCOUNTS_FILE;else process.env.QWEN_ACCOUNTS_FILE=previous;fs.rmSync(directory,{recursive:true,force:true});});
 for(const scenario of [{trySilent:true,fail:false,renewed:1,visible:0},{trySilent:true,fail:true,renewed:1,visible:1},{trySilent:false,fail:false,renewed:0,visible:1}]) {
  fs.writeFileSync(process.env.QWEN_ACCOUNTS_FILE,JSON.stringify([{id:'a',token:'old',profileDir:directory,invalid:true}]));
  let visible=0,renewed=0,prepared=0;
  const manager=createQwenAccountManager({readLegacy:()=>null,prepareLogin:async()=>{prepared++;},resetProxy:async()=>{},
   refreshProfile:async()=>{assert.equal(prepared,0);renewed++;if(scenario.fail)throw new Error('renewal failed');return {token:'fresh',cookies:[],cookieHeader:''};},
   login:async()=>{visible++;return {token:'fresh',cookies:[],cookieHeader:''};}});
  await manager.action({action:'login',id:'a',trySilent:scenario.trySilent});
  await manager.waitForLogin();
  assert.equal(renewed,scenario.renewed);
  assert.equal(visible,scenario.visible);
  assert.equal(prepared,1, "reconnect closes the old window after successful capture, or before the manual fallback");
  assert.equal((await manager.snapshot()).login.state,'done');
 }
});

test('an open authenticated Qwen browser renews account metadata without another browser or login',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qwen-live-renew-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 process.env.QWEN_ACCOUNTS_FILE=path.join(directory,'accounts.json');t.after(()=>delete process.env.QWEN_ACCOUNTS_FILE);
 const token=exp=>'header.'+Buffer.from(JSON.stringify({id:'same-user',exp})).toString('base64url')+'.sig';
 const expired=token(1),fresh=token(Math.floor(Date.now()/1000)+3600);
 fs.writeFileSync(process.env.QWEN_ACCOUNTS_FILE,JSON.stringify([{id:'a',token:expired,profileDir:directory}]));
 let captures=0;
 const manager=createQwenAccountManager({readLegacy:()=>null,
  refreshOpenBrowser:async id=>{captures++;assert.equal(id,'a');return {token:fresh,cookies:[],cookieHeader:''};},
  refreshProfile:()=>assert.fail('must not open a second browser'),resetProxy:()=>assert.fail('must not close the authenticated browser')});
 assert.equal((await manager.refreshAccount('a')).token,fresh);assert.equal(captures,1);
 assert.equal((await manager.snapshot()).accounts[0].status,'ready');
});

test('Qwen keeps actionable browser setup failures and the existing account', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qwen-setup-error-'));
  const previous=process.env.QWEN_ACCOUNTS_FILE;process.env.QWEN_ACCOUNTS_FILE=path.join(dir,'accounts.json');
  t.after(()=>{if(previous===undefined)delete process.env.QWEN_ACCOUNTS_FILE;else process.env.QWEN_ACCOUNTS_FILE=previous;fs.rmSync(dir,{recursive:true,force:true});});
  const original=[{id:'saved',token:'header.payload.signature',profileDir:dir,primary:true}];fs.writeFileSync(process.env.QWEN_ACCOUNTS_FILE,JSON.stringify(original));
  const failure=Object.assign(new Error('private subprocess details'),{code:'CAMOUFOX_PYTHON_REQUIRED',userMessage:'Установите Python 3.10+.'});
  const manager=createQwenAccountManager({readLegacy:()=>null,prepareLogin:async()=>{},login:async()=>{throw failure;}});
  await manager.action({action:'login',id:'saved'});await manager.waitForLogin();
  const snapshot=await manager.snapshot();assert.equal(snapshot.login.code,failure.code);assert.equal(snapshot.login.error,failure.userMessage);assert.deepEqual(manager.list(),original);
});

test('Qwen exposes finishing progress and ignores callbacks after the login job settles',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qwen-finishing-')),previous=process.env.QWEN_ACCOUNTS_FILE;
 process.env.QWEN_ACCOUNTS_FILE=path.join(dir,'accounts.json');
 t.after(()=>{if(previous===undefined)delete process.env.QWEN_ACCOUNTS_FILE;else process.env.QWEN_ACCOUNTS_FILE=previous;fs.rmSync(dir,{recursive:true,force:true});});
 const token='header.'+Buffer.from(JSON.stringify({id:'fixture',exp:9999999999})).toString('base64url')+'.signature';
 fs.writeFileSync(process.env.QWEN_ACCOUNTS_FILE,JSON.stringify([{id:'saved',token,profileDir:dir,primary:true}]));
 let report,finish;const manager=createQwenAccountManager({readLegacy:()=>null,prepareLogin:async()=>{},login:async(_file,opts)=>{report=opts.onProgress;await new Promise(r=>{finish=r;});return {token,cookies:[]};}});
 await manager.action({action:'login',id:'saved'});await new Promise(r=>setImmediate(r));
 try{assert.equal(typeof report,'function');report({phase:'closing',message:'Завершаем вход…'});assert.equal((await manager.snapshot()).login.phase,'closing');}
 finally{finish();await manager.waitForLogin();}
 report({phase:'closing',message:'late'});assert.equal((await manager.snapshot()).login.state,'done');
});
