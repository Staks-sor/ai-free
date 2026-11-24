import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DeepSeekChatClient } from '../src/providers/deepseek/client.mjs';
const run = promisify(execFile);
function client(accountId) {
  const c=new DeepSeekChatClient({cookieHeader:'',token:'',accountId});
  let prep=0;c.createPowHeader=async()=>{prep++;return '';};c._ensureSearchFeatureToken=async()=>{};
  return {c,prepared:()=>prep};
}

test('HTTP 429 is rejected once; shared cooldown blocks another client before PoW/fetch',async()=>{
  const original=globalThis.fetch;let sends=0;
  const first=client('rate-http'),second=client('rate-http'),other=client('other-http');
  try {
    globalThis.fetch=async()=>{sends++;return new Response('{}',{status:429,headers:{'retry-after':'600'}});};
    await assert.rejects(first.c.complete({sessionId:'s',prompt:'test'}),e=>e.code==='DEEPSEEK_RATE_LIMIT'&&e.delivery==='rejected'&&e.retryAfterMs===600000);
    await assert.rejects(second.c.complete({sessionId:'s',prompt:'test'}),e=>e.delivery==='not_sent'&&e.retryAfterMs>590000);
    assert.equal(first.prepared(),1);assert.equal(second.prepared(),0);assert.equal(sends,1);
    globalThis.fetch=async()=>{sends++;return new Response('data: {"v":"ok"}\n\n',{headers:{'content-type':'text/event-stream'}});};
    assert.equal((await other.c.complete({sessionId:'s',prompt:'test'})).text,'ok');
    assert.equal(sends,2);
  }finally{globalThis.fetch=original;}
});

test('partial SSE rate-limit preserves unknown delivery and never replays',async()=>{
  const original=globalThis.fetch;let sends=0;
  try{
    globalThis.fetch=async()=>{sends++;return new Response('data: {"v":"partial"}\n\nevent: hint\ndata: {"finish_reason":"rate_limit_reached"}\n\n',{headers:{'content-type':'text/event-stream'}});};
    const {c}=client('partial-rate');
    await assert.rejects(c.complete({sessionId:'s',prompt:'test'}),e=>e.code==='DEEPSEEK_RATE_LIMIT'&&e.delivery==='unknown'&&e.retryAfterMs===60000);
    await assert.rejects(c.complete({sessionId:'s',prompt:'test'}),e=>e.delivery==='not_sent');
    assert.equal(sends,1);
  }finally{globalThis.fetch=original;}
});

test('empty or interrupted streams never trigger a blind completion POST',async()=>{
  const original=globalThis.fetch;let sends=0;
  try{
    globalThis.fetch=async()=>{sends++;return new Response('event: ping\ndata: {}\n\n',{headers:{'content-type':'text/event-stream'}});};
    const {c}=client('empty');
    await assert.rejects(c.complete({sessionId:'s',prompt:'test'}),e=>e.code==='EMPTY_UPSTREAM_STREAM');
    assert.equal(sends,1);
  }finally{globalThis.fetch=original;}
});

test('Stop prevents dispatch even when issued during PoW preparation',async()=>{
  const original=globalThis.fetch;let sends=0;
  try{
    globalThis.fetch=async()=>{sends++;assert.fail('sent after stop');};
    const {c}=client('stop');const controller=new AbortController();
    c.createPowHeader=async()=>{controller.abort();return '';};
    await assert.rejects(c.complete({sessionId:'s',prompt:'test',signal:controller.signal}),e=>e.name==='AbortError');
    assert.equal(sends,0);
  }finally{globalThis.fetch=original;}
});

test('a fresh process observes a saved DeepSeek deadline and sends nothing',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deepseek-policy-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=new URL('../src/providers/deepseek/client.mjs',import.meta.url).href;
  const env={...process.env,SYNVOX_REQUEST_STATE_DIR:dir};
  const setup=`import assert from 'node:assert/strict';import {DeepSeekChatClient} from ${JSON.stringify(source)};
    const c=new DeepSeekChatClient({cookieHeader:'',token:''});c.createPowHeader=async()=>'';c._ensureSearchFeatureToken=async()=>{};
    globalThis.fetch=async()=>new Response('{}',{status:429,headers:{'retry-after':'3600'}});
    await assert.rejects(c.complete({sessionId:'s',prompt:'test'}),e=>e.retryAfterMs===3600000);`;
  await run(process.execPath,['--input-type=module','-e',setup],{env,timeout:10000});
  const check=`import assert from 'node:assert/strict';import {DeepSeekChatClient} from ${JSON.stringify(source)};
    const c=new DeepSeekChatClient({cookieHeader:'',token:''});c.createPowHeader=async()=>assert.fail('PoW during cooldown');
    globalThis.fetch=async()=>assert.fail('POST during cooldown');
    await assert.rejects(c.complete({sessionId:'s',prompt:'test'}),e=>e.code==='DEEPSEEK_RATE_LIMIT'&&e.delivery==='not_sent'&&e.retryAfterMs>3500000);`;
  await run(process.execPath,['--input-type=module','-e',check],{env,timeout:10000});
});

test('the active completion receives Stop and an aborted POST is never replayed',async()=>{
  const original=globalThis.fetch,controller=new AbortController();let sends=0,entered;
  const ready=new Promise(r=>{entered=r;});
  try{
    globalThis.fetch=async(_url,options)=>{
      sends++;assert.equal(options.signal,controller.signal);entered();
      return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}));
    };
    const {c}=client('active-stop');const pending=c.complete({sessionId:'s',prompt:'test',signal:controller.signal});
    await ready;controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(sends,1);
  }finally{globalThis.fetch=original;}
});
