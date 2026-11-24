import test from 'node:test';import assert from 'node:assert/strict';
import {harvestQwenCheckpoint} from '../src/providers/qwen/harvest.mjs';
import {createConversationHarnessRunner} from '../src/harness/conversation-runner.mjs';
import {createHarnessTask} from '../src/harness/task-state.mjs';

const cp={originalTransportClosed:true,phase:'awaiting_model',prompt:'tool result',parentMessageId:'parent',recoveryNotBefore:new Date(Date.now()-600_000).toISOString()};
function leaf(){return {ok:true,json:{success:true,data:{chat:{messages:[{id:'parent',role:'assistant',done:true,content:'last answer',childrenIds:[]}],history:{currentId:'parent',messages:{parent:{id:'parent',role:'assistant',done:true,content:'last answer',childrenIds:[]}},pagination:{has_more_newer:false,newest_id:'parent'}}}}}};}
test('complete, unchanged Qwen history proves an old pending turn was never created',async()=>{
 assert.deepEqual(await harvestQwenCheckpoint({fetcher:async()=>leaf(),chatId:'chat',checkpoint:cp}),{notSent:true});
 assert.equal(await harvestQwenCheckpoint({fetcher:async()=>leaf(),chatId:'chat',checkpoint:{...cp,originalTransportClosed:false}}),null);
 const incomplete=leaf();incomplete.json.data.chat.history.pagination.has_more_newer=true;
 assert.equal(await harvestQwenCheckpoint({fetcher:async()=>incomplete,chatId:'chat',checkpoint:cp}),null);
 assert.equal(await harvestQwenCheckpoint({fetcher:async()=>leaf(),chatId:'chat',checkpoint:{...cp,recoveryNotBefore:new Date().toISOString()}}),null);
});

test('manual continuation waits for the saved response and continues without another user message',async()=>{
 const task=createHarnessTask({goal:'fix',provider:'qwen',workspace:'/project'});
 Object.assign(task,{status:'paused',pauseReason:'challenge_required',failure:{kind:'challenge_required',delivery:'unknown'},checkpoint:cp});
 const c={provider:'qwen',workspace:'/project',harnessTask:task};let reads=0,runs=0,waits=0;
 const runner=createConversationHarnessRunner({persist:()=>{},wait:async()=>{waits++;assert.equal(runs,0);},runAgent:async(_client,_opts,_w,_g,_p,{resumeState})=>{runs++;assert.equal(resumeState.prompt,'tool result');return {message:'done'};}});
 await runner(c,{recoverCheckpoint:async()=>++reads===3}, {sessionId:'chat'},'/project','fix',null,{harnessResume:true});
 assert.equal(reads,3);assert.equal(waits,2);assert.equal(runs,1);assert.equal(task.status,'completed');assert.equal(task.nextResumeAt,null);
});

test('a proven absent turn resumes the saved checkpoint rather than remaining in manual recovery',async()=>{
 const task=createHarnessTask({goal:'fix',provider:'qwen',workspace:'/project'});
 Object.assign(task,{status:'paused',pauseReason:'challenge_required',failure:{kind:'challenge_required',delivery:'unknown'},checkpoint:cp});
 const c={provider:'qwen',workspace:'/project',harnessTask:task};let runs=0;
 const runner=createConversationHarnessRunner({autoContinue:false,persist:()=>{},runAgent:async()=>{runs++;return {message:'done'};}});
 await runner(c,{recoverCheckpoint:async()=> 'not_sent'}, {},'/project','fix',null,{harnessResume:true});assert.equal(runs,1);
});

test('a running Qwen task automatically recovers an uncertain reply and resumes once',async()=>{
 const c={provider:'qwen',workspace:'/project'};let runs=0,reads=0,waits=0;
 const runner=createConversationHarnessRunner({persist:()=>{},wait:async()=>{waits++;},runAgent:async(_c,_o,_w,_g,_p,options)=>{
  if(++runs===1){await options.onCheckpoint({...cp});throw Object.assign(new Error('transport'),{code:'QWEN_BROWSER_TRANSPORT_FAILURE',delivery:'unknown'});}
  assert.equal(options.resumeState.prompt,'tool result');return {message:'done'};
 }});
 await runner(c,{recoverCheckpoint:async()=>++reads===2},{},'/project','fix');
 assert.equal(runs,2);assert.equal(waits,1);assert.equal(c.harnessTask.status,'completed');
});

test('Stop cancels history waiting before any resumed model request',async()=>{
 const task=createHarnessTask({goal:'fix',provider:'qwen',workspace:'/project'});
 Object.assign(task,{status:'paused',pauseReason:'challenge_required',failure:{kind:'challenge_required',delivery:'unknown'},checkpoint:cp});
 const c={provider:'qwen',workspace:'/project',harnessTask:task};const controller=new AbortController();let reads=0;
 const runner=createConversationHarnessRunner({persist:()=>{},wait:async()=>{controller.abort();controller.signal.throwIfAborted();},runAgent:()=>assert.fail('must not resume')});
 await assert.rejects(runner(c,{recoverCheckpoint:async()=>{reads++;return false;}},{},'/project','fix',null,{harnessResume:true,signal:controller.signal}),e=>e.name==='AbortError');
 assert.equal(reads,1);assert.equal(task.nextResumeAt,null);
});
