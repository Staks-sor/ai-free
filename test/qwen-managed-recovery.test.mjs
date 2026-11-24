import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviderAccountPool} from '../src/providers/account-pool.mjs';
import {createQwenAccountSession} from '../src/providers/qwen/account-session.mjs';
import {createQwenAgentAdapter,createQwenAgentTransport} from '../src/providers/qwen/agent-adapter.mjs';
import {createConversationHarnessRunner} from '../src/harness/conversation-runner.mjs';
import {createHarnessTask} from '../src/harness/task-state.mjs';
import {runCodeTask} from '../src/code-agent/run.mjs';

function fixture(accounts=[{id:'a',primary:true},{id:'b'}]){
 const pool=createProviderAccountPool();pool.register('qwen',{listAccounts:()=>accounts});const calls=[];
 const session=createQwenAccountSession({pool,affinityKey:'task',initial:{accountId:'a',chatId:'saved-chat'},
  buildClient:async account=>({createChat:()=>assert.fail('must not create a chat during recovery'),
   complete:()=>assert.fail('must not resend the prompt'),
   recoverCheckpoint:async(chat,cp)=>{calls.push({id:account.id,chat,prompt:cp.prompt});return {text:JSON.stringify({tool:'finish',message:'Recovered answer'}),lastMessageId:'reply'};}})});
 return {session,pool,calls};
}

test('full managed coding chain restores the saved answer without reauth, chat creation or POST',async()=>{
 const {session,pool,calls}=fixture();
 const adapter=createQwenAgentAdapter(createQwenAgentTransport(operation=>operation(session)));
 const task=createHarnessTask({goal:'fix',provider:'qwen',workspace:'/project'});
 Object.assign(task,{status:'paused',failure:{delivery:'unknown',kind:'challenge_required'},pauseReason:'challenge_required',checkpoint:{phase:'awaiting_model',prompt:'saved prompt',parentMessageId:'parent'}});
 const c={provider:'qwen',workspace:'/project',harnessTask:task};
 const runner=createConversationHarnessRunner({autoContinue:false,persist:()=>{},runAgent:runCodeTask});
 await runner(c,adapter,{sessionId:'saved-chat'},'/project','fix',null,{harnessResume:true});
 assert.equal(c.harnessTask.status,'completed');assert.match(c.harnessTask.resultSummary,/Recovered answer/);assert.deepEqual(calls,[{id:'a',chat:'saved-chat',prompt:'saved prompt'}]);
 assert.ok((await pool.snapshot('qwen')).every(a=>!a.busy));
});

test('history recovery never switches to a different account or chat',async()=>{
 const {session,calls,pool}=fixture([{id:'a',invalid:true},{id:'b',primary:true}]);
 assert.equal(await session.recoverCheckpoint('saved-chat',{prompt:'p',parentMessageId:'parent'}),null);
 assert.equal(calls.length,0);assert.ok((await pool.snapshot('qwen')).every(a=>!a.busy));
 const good=fixture();assert.equal(await good.session.recoverCheckpoint('different-chat',{prompt:'p'}),null);assert.equal(good.calls.length,0);
});

test('unknown-delivery recovery silently renews its pinned account before reading history',async()=>{
 const accounts=[{id:'a',invalid:true},{id:'b',primary:true}];const pool=createProviderAccountPool();pool.register('qwen',{listAccounts:()=>accounts});let renews=0,reads=0;
 const session=createQwenAccountSession({pool,initial:{accountId:'a',chatId:'saved-chat'},refreshAccount:async id=>{assert.equal(id,'a');renews++;accounts[0].invalid=false;return accounts[0];},
  onLoginRequired:()=>assert.fail('must not open login'),buildClient:async account=>{assert.equal(account.id,'a');return {recoverCheckpoint:async()=>{reads++;return {text:'saved'};}};}});
 assert.equal((await session.recoverCheckpoint('saved-chat',{prompt:'saved',parentMessageId:'parent'})).text,'saved');
 assert.equal(renews,1);assert.equal(reads,1);assert.ok((await pool.snapshot('qwen')).every(a=>!a.busy));
});

test('actual server coding and pipeline wrappers expose recovery through the managed session',async()=>{
 const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
 const source=readFileSync(new URL('../src/window-app/server.mjs',import.meta.url),'utf8');
 const wrappers=[...source.matchAll(/const adapter = (createQwenAgentAdapter\([\s\S]*?\));\n\s*const workspacePath/g)];
 assert.equal(wrappers.length,2);
 for(const [,expression] of wrappers){
  const {session,calls}=fixture();
  const adapter=vm.runInNewContext(expression,{createQwenAgentAdapter,createQwenAgentTransport,qwenApiCall:(op,ref)=>op(ref.clientRef.client),workerLease:{client:session},qwenRequest:{client:session}});
  assert.equal(await adapter.recoverCheckpoint({prompt:'p',parentMessageId:'parent'},{sessionId:'saved-chat'}),true);
  const result=await adapter.complete({sessionId:'saved-chat',prompt:'p',parentMessageId:'parent'});assert.match(result.text,/Recovered answer/);assert.equal(calls.length,1);
 }
});
