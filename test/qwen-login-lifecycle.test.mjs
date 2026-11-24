import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const source = new URL('../src/providers/qwen/browser-login.mjs', import.meta.url);
const stub = 'data:text/javascript,' + encodeURIComponent('export const launchQwenCamoufoxSession=async()=>globalThis.qwenLoginSession;');
const code = fs.readFileSync(source, 'utf8').replace(/from "(\.[^"]+)"/g, (_, specifier) =>
  'from ' + JSON.stringify(specifier === './camoufox-session.mjs' ? stub : new URL(specifier, source).href));
const { loginQwenAndSave } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('login closes its browser when initial navigation fails', async () => {
  let closes = 0;
  const failure = new Error('page.goto: NS_ERROR_NET_TIMEOUT');
  globalThis.qwenLoginSession = { context: {}, page: { async goto() { throw failure; } }, async close() { closes++; } };
  await assert.rejects(loginQwenAndSave('/missing/qwen-auth.json'), error => error === failure);
  assert.equal(closes, 1);
});

test('a signed-in persistent profile with the saved JWT completes login and closes without waiting for token rotation', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-login-lifecycle-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'auth.json');
  const token = ['header', Buffer.from(JSON.stringify({ id: 'user', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url'), 'signature'].join('.');
  fs.writeFileSync(file, JSON.stringify({ token, cookies: [] }));
  let closes = 0, reads = 0;
  const page = { url: () => 'https://chat.qwen.ai/', async goto() {}, async bringToFront() {}, async evaluate() { return token; } };
  globalThis.qwenLoginSession = { page, context: { pages: () => [page], async cookies() { if (++reads > 1) throw new Error('login remained waiting after valid auth'); return [{ name: 'token', value: token, domain: '.qwen.ai' }]; }, async addCookies() {} }, async close() { closes++; } };
  const result = await loginQwenAndSave(file, { profileDir: dir });
  assert.equal(result.token, token);
  assert.equal(closes, 1);
  assert.equal(JSON.parse(fs.readFileSync(file)).token, token);
});

function authenticatedSession(t, close) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qwen-login-close-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const token=['header',Buffer.from(JSON.stringify({id:'fixture',exp:9999999999})).toString('base64url'),'signature'].join('.');
  const page={url:()=> 'https://chat.qwen.ai/',goto:async()=>{},bringToFront:async()=>{},evaluate:async()=>token};
  globalThis.qwenLoginSession={page,context:{pages:()=>[page],cookies:async()=>[],addCookies:async()=>{}},close};
  return {file:path.join(dir,'auth.json'),dir,token};
}
test('Qwen reports finishing and only prints login success after its browser has closed',async t=>{
  let finish,started=false;const {file,dir}=authenticatedSession(t,()=>{started=true;return new Promise(r=>{finish=r;});});
  const logs=[],progress=[],original=console.log;console.log=(...args)=>logs.push(args.join(' '));
  try{const pending=loginQwenAndSave(file,{profileDir:dir,onProgress:p=>progress.push(p)});
    while(!started)await new Promise(r=>setImmediate(r));
    assert.equal(progress.at(-1)?.phase,'closing');assert.equal(logs.some(s=>s.includes('login successful')),false);
    finish();await pending;assert.equal(logs.some(s=>s.includes('login successful')),true);
  }finally{finish?.();console.log=original;}
});
test('failed browser cleanup is surfaced without deleting captured Qwen auth',async t=>{
 const failure=Object.assign(new Error('close timed out'),{code:'CAMOUFOX_CLOSE_TIMEOUT',userMessage:'Перезапустите SYNVOX.'});
 const {file,dir,token}=authenticatedSession(t,async()=>{throw failure;});
 await assert.rejects(loginQwenAndSave(file,{profileDir:dir}),e=>e===failure);assert.equal(JSON.parse(fs.readFileSync(file)).token,token);
});
