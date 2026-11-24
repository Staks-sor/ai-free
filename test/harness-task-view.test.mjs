import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getHarnessTaskView, assertTaskContinuation } from '../src/harness/task-view.mjs';
import { conversationList } from '../src/state/conversations.mjs';

const fixture=()=>({id:'chat',provider:'glm',workspace:'/project',providerAccountId:'a1',roleId:'developer',skillId:'bug-fix',messages:[],
 harnessTask:{id:'task',goal:'Fix parsing',provider:'glm',workspace:'/project',accountId:'a1',status:'paused',pauseReason:'rate_limit',
 checkpoint:{phase:'awaiting_model',prompt:'private prompt'},failure:{kind:'rate_limited',delivery:'rejected'},
 verification:'passed',verificationChecks:[{name:'unit tests',cmd:'node',args:['--test'],status:0,ok:true,stdout:'private output'}],changedFiles:['app.mjs'],error:{stack:'private stack'}}});

test('task view exposes useful evidence and safe continuation without raw checkpoints or logs',()=>{
 const c=fixture(),view=getHarnessTaskView(c);
 assert.equal(view.canResume,true);assert.equal(view.canStop,false);assert.equal(view.verification,'passed');
 assert.equal(view.checks[0].ok,true);assert.deepEqual(view.changedFiles,['app.mjs']);
 assert.doesNotMatch(JSON.stringify(view),/private|checkpoint|stdout|stack|args|accountId/);
 assert.equal(conversationList({conversations:[c]})[0].taskView.id,'task');
 assert.equal(getHarnessTaskView({messages:[]}),null);
});

test('controls never resume uncertain work, active owners or a changed task/context',()=>{
 for(const patch of [{failure:{delivery:'unknown'}},{checkpoint:{phase:'executing_tool'}},
 {status:'running'},{nextResumeAt:'2030-01-01T00:00:00Z'}, {provider:'qwen'}, {workspace:'/other'}, {accountId:'a2'},
 {checkpoint:null}]){
  const c=fixture();Object.assign(c.harnessTask,patch);
  assert.equal(getHarnessTaskView(c).canResume,false,JSON.stringify(patch));
  assert.throws(()=>assertTaskContinuation(c,'task'),/продолж|проверь|выполн|контекст/i);
 }
 assert.throws(()=>assertTaskContinuation(fixture(),'old'),/измен/i);
 assert.equal(getHarnessTaskView(fixture(),{running:true}).canStop,true);
 assert.equal(getHarnessTaskView(fixture(),{running:true}).canResume,false);
 assert.doesNotThrow(()=>assertTaskContinuation(fixture(),'task'));
 const missing=fixture();delete missing.providerAccountId;assert.equal(getHarnessTaskView(missing).canResume,false);
});

test('verification is never green when evidence is absent, failed or invalidated by later work',()=>{
 const c=fixture();c.harnessTask.verificationChecks=[];assert.equal(getHarnessTaskView(c).verification,'not_run');
 c.harnessTask.verificationChecks=[{name:'test',ok:false,status:1}];assert.equal(getHarnessTaskView(c).verification,'failed');
 c.harnessTask.verification='not_run';assert.equal(getHarnessTaskView(c).verification,'not_run');
});

test('task inspector names native computer actions during execution', () => {
 const conversation=fixture();conversation.harnessTask.status='running';
 conversation.harnessTask.checkpoint={phase:'executing_tool',pendingAction:{tool:'computer_snapshot'}};
 assert.equal(getHarnessTaskView(conversation).currentTool,'computer_snapshot');
});
