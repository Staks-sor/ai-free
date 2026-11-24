import { readFileSync, mkdtempSync, symlinkSync, readlinkSync, rmSync } from 'node:fs';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitForAuthenticatedApiCall, validateDeepSeekBrowserSession, clearDeepSeekSessionCookies, deepSeekCamoufoxOptions, captureAuthFromContext, captchaResultSummary, observeDeepSeekCaptcha } from '../src/browser/login.mjs';
import { launchPersistentDeepSeekContext } from '../src/browser/launch.mjs';

test('failed silent DeepSeek refresh always closes its browser profile before visible login', () => {
  for (const file of ['src/browser/login.mjs', 'plugin-for-vscode/src/browser/login.mjs']) {
    const source = readFileSync(file, 'utf8');
    const refresh = source.match(/export async function refreshAuthFromProfile\(authFile, options = \{\}\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(refresh, /try \{[\s\S]*?collectAuthFromContext[\s\S]*?\} finally \{\s*await session\.close\(\)/, file);
  }
});

test('a live Chrome profile lock is never removed as if it were stale', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'synvox-deepseek-lock-'));
  const lock = join(profile, 'SingletonLock');
  symlinkSync(`local-${process.pid}`, lock);
  const chromium = { launchPersistentContext: async () => { throw new Error('ProcessSingleton'); } };
  try {
    await assert.rejects(launchPersistentDeepSeekContext(chromium, profile, true), /профиль.*используется|profile.*in use/i);
    assert.equal(readlinkSync(lock), `local-${process.pid}`);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

test('DeepSeek login and refresh use the same dedicated Camoufox storage', () => {
  const visible = deepSeekCamoufoxOptions(false);
  const silent = deepSeekCamoufoxOptions(true);
  assert.equal(visible.headless, false);
  assert.equal(silent.headless, true);
  assert.equal(visible.storageStatePath, silent.storageStatePath);
  assert.match(visible.storageStatePath, /camoufox\/deepseek\/storage-state\.json$/);
  for (const file of ['src/browser/login.mjs', 'plugin-for-vscode/src/browser/login.mjs']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /launchCamoufoxSession\(deepSeekCamoufoxOptions\(false, options\)\)/, file);
    assert.match(source, /launchCamoufoxSession\(deepSeekCamoufoxOptions\(true, options\)\)/, file);
    assert.doesNotMatch(source, /launchSystemChromeForManualLogin\(/, file);
  }
});

test('DeepSeek accepts a validated browser token without ds_session_id', async () => {
  const context = new EventEmitter();
  context.cookies = async () => [];
  const page = { evaluate: async (_callback, token) => token ? true : { path: '/', token: 'valid-user-token' } };
  await assert.doesNotReject(waitForAuthenticatedApiCall(context, { page, timeoutMs: 100, pollMs: 5, settleMs: 0 }));
  const captured = await captureAuthFromContext(context, { evaluate: async () => 'valid-user-token' });
  assert.equal(captured.token, 'valid-user-token');
});

test('hCaptcha diagnostics report pass/failure without response secrets', () => {
  const result = captchaResultSummary(200, { pass: false, error: 'challenge-expired', generated_pass_UUID: 'secret' });
  assert.deepEqual(result, { status: 200, pass: false, error: 'challenge-expired' });
});

test('DeepSeek login recognizes a completed browser session even without a new API response event', async () => {
  const context = new EventEmitter();
  context.cookies = async () => [{ name: 'ds_session_id', value: 'session' }];
  const page = { evaluate: async (_callback, token) => token ? true : { path: '/', token: 'valid-user-token' } };
  await assert.doesNotReject(waitForAuthenticatedApiCall(context, { page, timeoutMs: 100, pollMs: 10, settleMs: 0 }));
});

test('DeepSeek login keeps waiting when a cached token is rejected by the server', async () => {
  const context = new EventEmitter();
  context.cookies = async () => [{ name: 'ds_session_id', value: 'stale-session' }];
  const page = { evaluate: async (_callback, token) => token ? false : { path: '/', token: 'stale-token' } };
  await assert.rejects(waitForAuthenticatedApiCall(context, { page, timeoutMs: 40, pollMs: 5, settleMs: 0 }), /timed out/);
});

test('DeepSeek verifies the browser token against the current-user endpoint and its business code', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ code: 40003, data: null }) };
    };
    const page = { evaluate: (callback, token) => callback(token) };
    assert.equal(await validateDeepSeekBrowserSession(page, 'stale-token'), false);
    assert.equal(calls[0].url, '/api/v0/users/current');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer stale-token');
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ code: 0, data: { biz_data: { token: 'access-token' } } }) });
    assert.equal(await validateDeepSeekBrowserSession(page, 'valid-token'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('DeepSeek login retries a transient capture failure without dismissing the window', async () => {
  const context = new EventEmitter();
  context.cookies = async () => [{ name: 'ds_session_id', value: 'session' }];
  const page = { evaluate: async (_callback, token) => token ? true : { path: '/', token: 'valid-user-token' } };
  let attempts = 0;
  assert.equal(await waitForAuthenticatedApiCall(context, {
    page, timeoutMs: 100, pollMs: 5, settleMs: 0,
    onAuthenticated: async () => {
      attempts++;
      if (attempts === 1) throw new Error('token disappeared during navigation');
    },
  }), page);
  assert.equal(attempts, 2);
});

test('DeepSeek login does not accept stale token and cookie on the sign-in page', async () => {
  const context = new EventEmitter();
  context.cookies = async () => [{ name: 'ds_session_id', value: 'stale-session' }];
  const page = { evaluate: async () => ({ path: '/sign_in', token: 'stale-token' }) };
  await assert.rejects(waitForAuthenticatedApiCall(context, { page, timeoutMs: 30, pollMs: 5, settleMs: 0 }), /timed out/);
});

test('DeepSeek login ignores a successful background API event while the captcha sign-in page remains open', async () => {
  const context = new EventEmitter();
  context.cookies = async () => [{ name: 'ds_session_id', value: 'stale-session' }];
  const page = { evaluate: async () => ({ path: '/sign_in', token: 'stale-token' }) };
  const waiting = waitForAuthenticatedApiCall(context, { page, timeoutMs: 45, pollMs: 5, settleMs: 0 });
  context.emit('response', {
    url: () => 'https://chat.deepseek.com/api/v0/user/info',
    status: () => 200,
    request: () => ({ headers: () => ({ authorization: 'Bearer stale-user-token' }) }),
    json: async () => ({ code: 0 }),
  });
  await assert.rejects(waiting, /timed out/);
});

test('DeepSeek re-login clears only its session cookie and preserves WAF clearance', async () => {
  const calls = [];
  await clearDeepSeekSessionCookies({ clearCookies: async options => calls.push(options) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].domain.test('.deepseek.com'), true);
  assert.equal(calls[0].domain.test('accounts.google.com'), false);
  assert.equal(calls[0].name.test('ds_session_id'), true);
  assert.equal(calls[0].name.test('aws-waf-token'), false);
});

test('closing the last DeepSeek login tab ends the wait', async () => {
  const context = new EventEmitter();
  context.cookies = async () => [];
  context.pages = () => [];
  await assert.rejects(waitForAuthenticatedApiCall(context, {
    timeoutMs: 200, pollMs: 5, emptyPagesGraceMs: 15,
  }), /окно.*закрыто|closed/i);
});

test('closing the Camoufox login browser stops the wait immediately', async () => {
  const context = new EventEmitter();
  context.cookies = async () => [];
  const page = new EventEmitter();
  page.evaluate = async () => ({ path: '/sign_in', token: '' });
  const pending = waitForAuthenticatedApiCall(context, { page, timeoutMs: 1000, pollMs: 20, settleMs: 0 });
  context.emit('close');
  await assert.rejects(pending, /closed|закрыт/i);
});

test('DeepSeek login follows a Google OAuth tab back to the authenticated DeepSeek page', async () => {
  const context = new EventEmitter();
  context.cookies = async () => [{ name: 'ds_session_id', value: 'session' }];
  const original = new EventEmitter();
  original.url = () => 'https://accounts.google.com/';
  original.evaluate = async () => { throw new Error('original page closed'); };
  const returnPage = new EventEmitter();
  returnPage.url = () => 'https://chat.deepseek.com/';
  returnPage.evaluate = async (_callback, token) => token ? true : ({ path: '/', token: 'valid-user-token' });
  context.pages = () => [original, returnPage];
  const pending = waitForAuthenticatedApiCall(context, { page: original, timeoutMs: 100, pollMs: 5, settleMs: 0 });
  original.emit('close');
  assert.equal(await pending, returnPage);
});

test('DeepSeek login prefers the authenticated return tab over an old sign-in tab', async () => {
  const context = new EventEmitter();
  context.cookies = async () => [{ name: 'ds_session_id', value: 'session' }];
  const oldPage = { url: () => 'https://chat.deepseek.com/sign_in', evaluate: async () => ({ path: '/sign_in', token: '' }) };
  const returnPage = { url: () => 'https://chat.deepseek.com/', evaluate: async (_callback, token) => token ? true : ({ path: '/', token: 'valid-user-token' }) };
  context.pages = () => [oldPage, returnPage];
  assert.equal(await waitForAuthenticatedApiCall(context, { page: oldPage, timeoutMs: 60, pollMs: 5, settleMs: 0 }), returnPage);
});


test('missing or unreadable hCaptcha pass is unknown, not a rejected solution', () => {
  for (const body of [null, {}, {pass: 'false'}, {success: false}]) {
    assert.equal(captchaResultSummary(200, body).pass, null);
  }
  assert.equal(captchaResultSummary(200, {pass: true}).pass, true);
  assert.deepEqual(captchaResultSummary(200, {'error-codes':['network-error','private/value'],generated_pass_UUID:'secret'}),
    {status:200,pass:null,errorCodes:['network-error']});
});

test('captcha progress distinguishes missing results, rejected attempts and confirmed checks without authorizing the account', async () => {
  const context=new EventEmitter(),progress=[];
  const stop=observeDeepSeekCaptcha(context,value=>progress.push(value));
  const emit=body=>context.emit('response',{url:()=> 'https://api.hcaptcha.com/checkcaptcha/fixture',status:()=>200,json:async()=>body});
  emit(null);await new Promise(resolve=>setImmediate(resolve));
  emit({pass:false});await new Promise(resolve=>setImmediate(resolve));
  emit({pass:true,generated_pass_UUID:'secret'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(progress.length,3);assert.ok(progress.every(p=>p.phase==='captcha'));
  assert.match(progress[0].message,/не определён/);assert.match(progress[1].message,/не подтвердила/);assert.match(progress[2].message,/подтверждена.*вход/i);
  assert.doesNotMatch(JSON.stringify(progress),/secret/);stop();assert.equal(context.listenerCount('response'),0);
});

test('a passed hCaptcha event does not complete DeepSeek login without authenticated browser evidence', async () => {
  const context=new EventEmitter();
  const page={evaluate:async()=>({path:'/sign_in',token:''})};
  const pending=waitForAuthenticatedApiCall(context,{page,timeoutMs:35,pollMs:5});
  context.emit('response',{url:()=> 'https://api.hcaptcha.com/checkcaptcha/fixture',status:()=>200,json:async()=>({pass:true})});
  await assert.rejects(pending,error=>error.code==='DEEPSEEK_LOGIN_TIMEOUT');
});
