import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('network failure during silent renewal preserves the session and reports transport failure', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-refresh-network-'));
  t.after(() => { delete globalThis.__qwenRefreshNetworkSession; fs.rmSync(root, { recursive: true, force: true }); });
  const file = path.join(root, 'auth.json');
  const saved = JSON.stringify({ token: 'saved-token', cookies: [{ name: 'refresh_token', value: 'saved-session' }], profileDir: root });
  fs.writeFileSync(file, saved);
  let closed = 0;
  globalThis.__qwenRefreshNetworkSession = { context: { async cookies() { return []; }, async addCookies() {}, async addInitScript() {} },
    page: { async goto() { throw new Error('page.goto: Timeout 30000ms exceeded.'); } }, async close() { closed++; } };
  const source = new URL('../src/providers/qwen/browser-login.mjs', import.meta.url);
  const stub = 'data:text/javascript,' + encodeURIComponent('export const launchQwenCamoufoxSession=async()=>globalThis.__qwenRefreshNetworkSession;');
  const code = fs.readFileSync(source, 'utf8').replace(/from "(\.[^"]+)"/g, (_, spec) => 'from ' + JSON.stringify(spec === './camoufox-session.mjs' ? stub : new URL(spec, source).href));
  const { refreshQwenAuthFromProfile } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  await assert.rejects(refreshQwenAuthFromProfile(file), error => error.code === 'QWEN_SESSION_REFRESH_UNAVAILABLE' && error.delivery === 'not_sent');
  assert.equal(fs.readFileSync(file, 'utf8'), saved);
  assert.equal(closed, 1);
});

test('silent refresh waits for SPA token renewal instead of opening login after a fixed delay', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'qwen-refresh-'));
  const jwt = exp => 'header.'+Buffer.from(JSON.stringify({exp})).toString('base64url')+'.signature';
  const old = jwt(1), fresh = jwt(Math.floor(Date.now()/1000)+3600);
  const file = path.join(root,'auth.json');
  fs.writeFileSync(file,JSON.stringify({token:old,cookies:[],profileDir:root}));
  let reads=0, closed=0;
  const page = {url:()=> 'https://chat.qwen.ai/',goto:async()=>{},waitForTimeout:async()=>{},
    evaluate:async (_fn,arg)=>arg ? undefined : (++reads>=3 ? fresh : old)};
  globalThis.__qwenRefreshSession={page,context:{addCookies:async()=>{},addInitScript:async()=>{},
    cookies:async()=>[],pages:()=>[page]},close:async()=>{closed++;}};
  try {
    const source = new URL('../src/providers/qwen/browser-login.mjs',import.meta.url);
    const stub = 'data:text/javascript,'+encodeURIComponent('export const launchQwenCamoufoxSession=async()=>globalThis.__qwenRefreshSession;');
    const code=fs.readFileSync(source,'utf8').replace(/from "(\.[^"]+)"/g,(_,spec)=>'from '+JSON.stringify(spec==='./camoufox-session.mjs'?stub:new URL(spec,source).href));
    const {refreshQwenAuthFromProfile}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
    const result=await refreshQwenAuthFromProfile(file);
    assert.equal(result.token,fresh);
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).token,fresh);
    assert.equal(closed,1);
  } finally {delete globalThis.__qwenRefreshSession;fs.rmSync(root,{recursive:true,force:true});}
});
