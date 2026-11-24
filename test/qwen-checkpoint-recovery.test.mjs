import {test} from 'node:test';
import assert from 'node:assert/strict';
import {harvestQwenCheckpoint} from '../src/providers/qwen/harvest.mjs';
import {createConversationHarnessRunner} from '../src/harness/conversation-runner.mjs';
import {createHarnessTask} from '../src/harness/task-state.mjs';

test('checkpoint recovery accepts only a finished answer to the exact saved prompt and parent',async()=>{
 const checkpoint={prompt:'tool result',parentMessageId:'previous'};
 const user={id:'user',role:'user',content:'tool result',parentId:'previous'};
 const answer={id:'answer',role:'assistant',content:'saved answer',parentId:'user',done:true};
 const fetcher=async()=>[user,answer];
 assert.equal((await harvestQwenCheckpoint({fetcher,chatId:'chat',checkpoint})).text,'saved answer');
 for(const messages of [[{...user,content:'other'},answer],[user,{...answer,done:false}],[user,{...answer,parentId:'different'}],[user,answer,{...user,id:'duplicate'}]]){
  assert.equal(await harvestQwenCheckpoint({fetcher:async()=>messages,chatId:'chat',checkpoint}),null);
 }
});

test('unknown delivery can resume only after adapter recovers the same saved answer without POST',async()=>{
 const task=createHarnessTask({goal:'fix',provider:'qwen',workspace:'/project'});
 Object.assign(task,{status:'paused',pauseReason:'challenge_required',failure:{kind:'challenge_required',delivery:'unknown'},checkpoint:{phase:'awaiting_model',prompt:'saved',parentMessageId:'parent'}});
 const c={provider:'qwen',workspace:'/project',harnessTask:task};let runs=0,reads=0;
 const runner=createConversationHarnessRunner({autoContinue:false,persist:()=>{},runAgent:async()=>{runs++;return {message:'done'};}});
 await assert.rejects(runner(c,{recoverCheckpoint:async()=>{reads++;return false;}},{},'/project','fix',null,{harnessResume:true}),e=>e.code==='HARNESS_REVIEW_REQUIRED');
 assert.equal(runs,0);
 await runner(c,{recoverCheckpoint:async(cp)=>{reads++;assert.equal(cp.prompt,'saved');return true;}},{},'/project','fix',null,{harnessResume:true});
 assert.equal(runs,1);assert.equal(reads,2);
});

test('Qwen adapter consumes the recovered answer once without sending a duplicate turn',async()=>{
 const {createQwenAgentAdapter}=await import('../src/providers/qwen/agent-adapter.mjs');let sends=0;
 const adapter=createQwenAgentAdapter({recoverCheckpoint:async()=>({text:'saved',lastMessageId:'reply'}),complete:async()=>{sends++;return {text:'next',lastMessageId:'next-reply'};}});
 const checkpoint={prompt:'saved prompt',parentMessageId:'parent'};
 assert.equal(await adapter.recoverCheckpoint(checkpoint,{sessionId:'chat'}),true);
 assert.deepEqual(await adapter.complete({sessionId:'chat',prompt:checkpoint.prompt,parentMessageId:'parent'}),{text:'saved',lastAssistantMessageId:'reply'});
 assert.equal(sends,0);
 await adapter.complete({sessionId:'chat',prompt:'next prompt',parentMessageId:'reply'});assert.equal(sends,1);
});

test('a recovered answer cannot authorize a POST for a changed checkpoint',async()=>{
 const {createQwenAgentAdapter}=await import('../src/providers/qwen/agent-adapter.mjs');
 const adapter=createQwenAgentAdapter({recoverCheckpoint:async()=>({text:'saved',lastMessageId:'answer'}),complete:()=>assert.fail('must not repost')});
 await adapter.recoverCheckpoint({prompt:'original',parentMessageId:'parent'},{sessionId:'chat'});
 await assert.rejects(adapter.complete({sessionId:'chat',prompt:'changed',parentMessageId:'parent'}),e=>e.code==='HARNESS_REVIEW_REQUIRED');
});

test('real Qwen client recovers history through GET only, including a saved attachment turn',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const source=new URL('../src/providers/qwen/client.mjs',import.meta.url).href;
 await promisify(execFile)(process.execPath,['--input-type=module','-e',`
  import fs from 'node:fs';import assert from 'node:assert/strict';
  const source=${JSON.stringify(source)};
  const stub='data:text/javascript,'+encodeURIComponent('export const getQwenBrowserProxy=async()=>globalThis.proxy; export const resetQwenBrowserProxy=async()=>{};');
  const code=fs.readFileSync(new URL(source),'utf8').replace(/from "(\\.[^"]+)"/g,(_,specifier)=>'from '+JSON.stringify(specifier==='./browser-proxy.mjs'?stub:new URL(specifier,source).href));
  const {QwenChatClient}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  let reads=0;
  globalThis.proxy={proxyApiGet:async()=>{reads++;return {ok:true,json:{data:{chat:{messages:[{id:'u',role:'user',parentId:'parent',content:'uploaded prompt'},{id:'a',role:'assistant',parentId:'u',done:true,content:'answer'}]}}}};}};
  const client=new QwenChatClient({token:'',cookieHeader:''});
  const checkpoint={prompt:'original large prompt',parentMessageId:'parent',qwenTurn:{chatId:'chat',prompt:'uploaded prompt',parentMessageId:'parent'}};
  assert.equal((await client.recoverCheckpoint('chat',checkpoint)).text,'answer');
  assert.equal(await client.recoverCheckpoint('other',checkpoint),null);
  assert.equal(reads,1);
  globalThis.proxy={proxyApiGet:async()=>({ok:true,json:{success:true,data:{chat:{history:{currentId:'parent',pagination:{has_more_newer:false,newest_id:'parent'},messages:{parent:{id:'parent',role:'assistant',done:true,childrenIds:[]}}}}}}})};
  const absent={...checkpoint,originalTransportClosed:true,recoveryNotBefore:new Date(Date.now()-600000).toISOString()};
  assert.deepEqual(await client.recoverCheckpoint('chat',absent),{notSent:true});
  assert.equal(await client.recoverCheckpoint('chat',{...absent,originalTransportClosed:false}),null);
  globalThis.proxy.pendingCompletionRequests=async()=>0;
  assert.deepEqual(await client.recoverCheckpoint('chat',{...absent,originalTransportClosed:false}),{notSent:true});
  globalThis.proxy.pendingCompletionRequests=async()=>1;
  assert.equal(await client.recoverCheckpoint('chat',absent),null);
 `],{timeout:15000});
});
