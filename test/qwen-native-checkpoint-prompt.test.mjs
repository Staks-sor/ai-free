import test from 'node:test';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';

test('native checkpoint without dispatch metadata matches its full prompt, never legacy upload text', async () => {
 const source = new URL('../src/providers/qwen/client.mjs', import.meta.url).href;
 await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
  import fs from 'node:fs'; import assert from 'node:assert/strict';
  const source=${JSON.stringify(source)};
  const stub='data:text/javascript,'+encodeURIComponent('export const getQwenBrowserProxy=async()=>globalThis.proxy;export const resetQwenBrowserProxy=async()=>{};');
  const code=fs.readFileSync(new URL(source),'utf8').replace(/from "(\\.[^"]+)"/g,(_,s)=>'from '+JSON.stringify(s==='./browser-proxy.mjs'?stub:new URL(s,source).href));
  const {QwenChatClient}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  const prompt='saved native prompt '+ 'x'.repeat(100000); let reads=0;
  globalThis.proxy={submitNativeTurn:()=>assert.fail('must not send'),pendingCompletionRequests:async()=>0,
   proxyApiGet:async()=>{reads++;return {ok:true,status:200,json:{success:true,data:{chat:{messages:[
    {id:'user',role:'user',parentId:'parent',content:prompt},
    {id:'answer',role:'assistant',parentId:'user',done:true,content:'saved answer'}
   ]}}}};}};
  const client=new QwenChatClient({token:'',cookieHeader:''});
  assert.equal((await client.recoverCheckpoint('chat',{prompt,parentMessageId:'parent'}))?.text,'saved answer');
  assert.equal(reads,1);
 `],{timeout:15000});
});
