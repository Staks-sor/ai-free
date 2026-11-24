import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequestBudgetStore } from '../src/providers/request-budget-store.mjs';
const run = promisify(execFile);
const initial = { nextAllowedAt: 0, cooldownUntil: 0 };
function directory(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'synvox-budget-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir; }

test('persists deadlines across instances and isolates accounts/providers', t => {
  const dir=directory(t), a=createRequestBudgetStore(dir,initial), b=createRequestBudgetStore(dir,initial);
  a.update('qwen/account-a',s=>{s.cooldownUntil=10000;});
  assert.equal(b.read('qwen/account-a').cooldownUntil,10000);
  assert.equal(b.read('qwen/account-b').cooldownUntil,0);
  assert.equal(b.read('glm/account-a').cooldownUntil,0);
});

test('two processes reserve one shared sequence without lost updates; disk stays bounded', async t => {
  const dir=directory(t), module=new URL('../src/providers/request-budget-store.mjs',import.meta.url).href;
  const code=`import {createRequestBudgetStore} from ${JSON.stringify(module)};const store=createRequestBudgetStore(process.argv[1],${JSON.stringify(initial)});const result=[];for(let i=0;i<20;i++)result.push(store.update('qwen/shared',s=>{s.nextAllowedAt+=100;}).nextAllowedAt);console.log(JSON.stringify(result));`;
  const outputs=await Promise.all([run(process.execPath,['--input-type=module','-e',code,dir]),run(process.execPath,['--input-type=module','-e',code,dir])]);
  const values=outputs.flatMap(o=>JSON.parse(o.stdout)).sort((a,b)=>a-b);
  assert.deepEqual(values,Array.from({length:40},(_,i)=>(i+1)*100));
  assert.equal(createRequestBudgetStore(dir,initial).read('qwen/shared').nextAllowedAt,4000);
  assert.ok(fs.readdirSync(path.join(dir,fs.readdirSync(dir)[0])).length<=2);
  assert.doesNotMatch(fs.readdirSync(dir).join(''),/qwen|shared/);
});

test('ignores unfinished staging after a crash and refuses corrupt committed state', t => {
  const dir=directory(t), store=createRequestBudgetStore(dir,initial);
  store.update('qwen/a',s=>{s.cooldownUntil=10000;});
  const accountDir=path.join(dir,fs.readdirSync(dir)[0]);
  fs.writeFileSync(path.join(accountDir,'999999999-00000000-0000-0000-0000-000000000000.tmp'),'{');
  assert.equal(store.read('qwen/a').cooldownUntil,10000);
  store.update('qwen/a',s=>{s.nextAllowedAt=100;});
  assert.ok(!fs.readdirSync(accountDir).some(n=>n.endsWith('.tmp')));
  const head=fs.readdirSync(accountDir).filter(n=>n.endsWith('.json')).sort().at(-1);
  fs.writeFileSync(path.join(accountDir,head),'{');
  assert.throws(()=>store.read('qwen/a'),e=>e.code==='REQUEST_BUDGET_CORRUPT'&&e.delivery==='unknown');
});

test('Qwen production pacing shares spacing and restrictions across fresh processes', async t => {
  const dir=directory(t), module=new URL('../src/providers/qwen/request-pacing.mjs',import.meta.url).href;
  const env={...process.env,SYNVOX_REQUEST_STATE_DIR:dir,QWEN_COMPLETION_MIN_INTERVAL_MS:'100'};
  const slot=`import {waitForQwenCompletionSlot} from ${JSON.stringify(module)};let admittedAt;await waitForQwenCompletionSlot({accountId:'shared',now:()=>{admittedAt=Date.now();return admittedAt;}});console.log(admittedAt);`;
  const outputs=await Promise.all([run(process.execPath,['--input-type=module','-e',slot],{env}),run(process.execPath,['--input-type=module','-e',slot],{env})]);
  const times=outputs.map(o=>Number(o.stdout)).sort((a,b)=>a-b);
  assert.ok(times[1]-times[0]>=100,`gap ${times[1]-times[0]}ms`);
  const punish=`import {registerQwenRetryAfter} from ${JSON.stringify(module)};registerQwenRetryAfter('10',Date.now(),'shared');`;
  await run(process.execPath,['--input-type=module','-e',punish],{env});
  const check=`import {waitForQwenCompletionSlot} from ${JSON.stringify(module)};try{await waitForQwenCompletionSlot({accountId:'shared'});console.log('sent');}catch(e){console.log(JSON.stringify({code:e.code,delivery:e.delivery}));}`;
  const result=JSON.parse((await run(process.execPath,['--input-type=module','-e',check],{env})).stdout);
  assert.deepEqual(result,{code:'QWEN_RATE_LIMIT',delivery:'not_sent'});
});

test('the real Qwen browser client records HTTP 429 once and blocks a second POST', async t => {
  const dir=directory(t), source=new URL('../src/providers/qwen/client.mjs',import.meta.url).href;
  const code=`import fs from 'node:fs';import assert from 'node:assert/strict';
    const source=${JSON.stringify(source)};
    const stub='data:text/javascript,'+encodeURIComponent('export const getQwenBrowserProxy=async()=>globalThis.proxy;export const resetQwenBrowserProxy=async()=>{};');
    let code=fs.readFileSync(new URL(source),'utf8').replace(/from "(\\.[^"]+)"/g,(_,specifier)=>'from '+JSON.stringify(specifier==='./browser-proxy.mjs'?stub:new URL(specifier,source).href));
    const {QwenChatClient}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
    let sends=0;globalThis.proxy={proxyFetch:async options=>{await options.beforeSend();sends++;return {ok:false,status:429,text:'{}',retryAfter:'10'};}};
    const client=new QwenChatClient({token:'',cookieHeader:''});
    await assert.rejects(client.complete({chatId:'id',prompt:'test'}),e=>e.status===429&&e.retryAfterMs>=9900&&e.delivery==='rejected');
    await assert.rejects(client.complete({chatId:'id',prompt:'test'}),e=>e.code==='QWEN_RATE_LIMIT'&&e.delivery==='not_sent');
    assert.equal(sends,1);`;
  await run(process.execPath,['--input-type=module','-e',code],{env:{...process.env,SYNVOX_REQUEST_STATE_DIR:dir,QWEN_TRANSPORT:'browser',QWEN_COMPLETION_MIN_INTERVAL_MS:'0'},timeout:10000});
});

test('CAS handles a pruned revision being reused and returns its own reservation under contention', t => {
  const dir=directory(t), store=createRequestBudgetStore(dir,initial);
  const original=fs.linkSync;
  let injected=false;
  try {
    fs.linkSync=(from,to)=>{
      if(!injected){injected=true;for(let i=0;i<35;i++)store.update('qwen/race',s=>{s.nextAllowedAt+=100;});}
      return original(from,to);
    };
    assert.equal(store.update('qwen/race',s=>{s.nextAllowedAt+=100;}).nextAllowedAt,3600);
    assert.equal(store.read('qwen/race').nextAllowedAt,3600);
    injected=false;
    fs.linkSync=(from,to)=>{
      const result=original(from,to);
      if(!injected){injected=true;store.update('qwen/race',s=>{s.nextAllowedAt+=100;});}
      return result;
    };
    assert.equal(store.update('qwen/race',s=>{s.nextAllowedAt+=100;}).nextAllowedAt,3700);
    assert.equal(store.read('qwen/race').nextAllowedAt,3800);
  }finally{fs.linkSync=original;}
});

test('SIGKILL before/after publication preserves restrictions and committed reservations',async t=>{
  const dir=directory(t), module=new URL('../src/providers/request-budget-store.mjs',import.meta.url).href;
  const store=createRequestBudgetStore(dir,initial);
  store.update('qwen/crash',s=>{s.cooldownUntil=10000;});
  for(const publish of [false,true]){
    const code=`import fs from 'node:fs';import {createRequestBudgetStore} from ${JSON.stringify(module)};
      const link=fs.linkSync;fs.linkSync=(from,to)=>{if(${publish})link(from,to);process.kill(process.pid,'SIGKILL');};
      createRequestBudgetStore(process.argv[1],${JSON.stringify(initial)}).update('qwen/crash',s=>{s.nextAllowedAt=1000;});`;
    await assert.rejects(run(process.execPath,['--input-type=module','-e',code,dir]),e=>e.signal==='SIGKILL');
    assert.deepEqual(store.read('qwen/crash'),{cooldownUntil:10000,nextAllowedAt:publish?1000:0});
  }
});

test('invalid numeric updates cannot replace a valid deadline',t=>{
  const dir=directory(t),store=createRequestBudgetStore(dir,initial);
  store.update('qwen/invalid',s=>{s.cooldownUntil=10000;});
  assert.throws(()=>store.update('qwen/invalid',s=>{s.cooldownUntil=Infinity;}),e=>e.code==='REQUEST_BUDGET_INVALID');
  assert.equal(store.read('qwen/invalid').cooldownUntil,10000);
});

test('direct Qwen 429 persists Retry-After and a later call does not send again',async t=>{
  const dir=directory(t),source=new URL('../src/providers/qwen/client.mjs',import.meta.url).href;
  const code=`import assert from 'node:assert/strict';import {QwenChatClient} from ${JSON.stringify(source)};
    let sends=0;globalThis.fetch=async()=>{sends++;return new Response('{}',{status:429,headers:{'retry-after':'3600'}});};
    const client=new QwenChatClient({token:'',cookieHeader:''});
    await assert.rejects(client.complete({chatId:'id',prompt:'test'}),e=>e.status===429&&e.retryAfterMs===3600000&&e.delivery==='rejected');
    await assert.rejects(client.complete({chatId:'id',prompt:'test'}),e=>e.code==='QWEN_RATE_LIMIT'&&e.retryAfterMs>3500000&&e.delivery==='not_sent');
    assert.equal(sends,1);`;
  await run(process.execPath,['--input-type=module','-e',code],{env:{...process.env,SYNVOX_REQUEST_STATE_DIR:dir,QWEN_TRANSPORT:'direct',QWEN_COMPLETION_MIN_INTERVAL_MS:'0'},timeout:10000});
});
