import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTaskHandoff, buildConversationPrompt } from '../src/harness/handoff.mjs';
import { buildAgentTaskOptions } from '../src/window-app/agent-task.mjs';

const source = () => ({ id: 'source', provider: 'qwen', workspace: '/project', roleId: 'developer', skillId: 'bug-fix',
  codeSessionId: 'private-session', qwenCodeAccountId: 'private-account', messages: [],
  harnessTask: { id: 'task1', goal: 'Fix the error', status: 'completed', changedFiles: ['src/app.mjs'],
    resultSummary: 'Fixed parsing; password=secret-value Bearer private-token {"password": "json-private-secret"}', verification: 'passed',
    verificationChecks: [{ name: 'unit tests', cmd: 'node', args: ['--test'], ok: true, status: 0, stdout: 'cookie=private-cookie' }] } });

test('handoff contains bounded goal, changes and actual check evidence, never sessions or raw logs', () => {
  const handoff = buildTaskHandoff(source());
  assert.equal(handoff.sourceConversationId, 'source');
  assert.equal(handoff.sourceTaskId, 'task1');
  assert.equal(handoff.skillId, 'bug-fix');
  assert.match(handoff.context, /Fix the error|src\/app.mjs|unit tests/);
  assert.match(handoff.context, /passed/);
  assert.doesNotMatch(JSON.stringify(handoff), /private-session|private-account|secret-value|private-token|private-cookie|json-private-secret|stdout/);
  const long = source(); long.harnessTask.goal = 'я'.repeat(100000); long.harnessTask.resultSummary = 'x'.repeat(100000);
  assert.ok(Buffer.byteLength(buildTaskHandoff(long).context) <= 8192);
});

test('handoff refuses active work, interrupted tools and ambiguous model delivery', () => {
  for (const patch of [{ status: 'running' }, { status: 'paused', nextResumeAt: 'later' },
    { status: 'interrupted', checkpoint: { phase: 'executing_tool' } },
    { status: 'failed', checkpoint: { phase: 'awaiting_model' }, failure: { delivery: 'unknown' } },
    { status: 'interrupted', checkpoint: { phase: 'awaiting_model' } }]) {
    const c = source(); Object.assign(c.harnessTask, patch);
    assert.throws(() => buildTaskHandoff(c), /заверш|проверь|останов/i);
  }
  const c=source(); c.harnessTask.status='paused'; c.harnessTask.checkpoint={phase:'awaiting_model'}; c.harnessTask.failure={delivery:'not_sent'};
  assert.ok(buildTaskHandoff(c).context);
});

test('roles and handoff reach both chat and coding, unchanged assistant chat stays compact', () => {
  const c = { provider: 'glm', roleId: 'reviewer', handoff: buildTaskHandoff(source()) };
  const options=buildAgentTaskOptions(c, {}, { agentInput: {}, systemPrompt:'hardware instruction' });
  assert.match(options.systemPrompt, /reviewer/i);
  assert.match(options.systemPrompt, /hardware instruction/);
  assert.match(options.systemPrompt, /Fix the error/);
  assert.equal(options.roleId, 'reviewer');
  assert.match(buildConversationPrompt('What changed?',c),/reviewer|Fix the error/);
  assert.equal(buildConversationPrompt('Hi', { roleId:'assistant' }), 'Hi');
});

test('runner records role, changed paths and verification without copying tool output', async () => {
  const { createConversationHarnessRunner } = await import('../src/harness/conversation-runner.mjs');
  const c={id:'c',provider:'glm',workspace:'/project',roleId:'developer'};
  const run=createConversationHarnessRunner({persist:async()=>{}, runAgent:async(_client,_base,_workspace,_goal,_parent,options)=>{
    options.onTool({tool:'write_file',path:'src/app.mjs'}, {ok:true});
    options.onTool({tool:'write_file',path:'ignored.mjs'}, {ok:false,error:'denied'});
    options.onTool({tool:'verify_task'}, {verification:'passed',checks:[{name:'test',ok:true,status:0}]});
    return {message:'Implemented parsing'};
  }});
  await run(c,{}, {}, '/project','Fix the error',null,{roleId:'developer',skillId:'bug-fix'});
  assert.equal(c.harnessTask.roleId,'developer');
  assert.equal(c.harnessTask.skillId,'bug-fix');
  assert.deepEqual(c.harnessTask.changedFiles,['src/app.mjs']);
  assert.equal(c.harnessTask.resultSummary,'Implemented parsing');
  assert.match(buildTaskHandoff(c).context,/src\/app.mjs|Implemented parsing/);
});

test('handoff creation finds the source on the server and requires its workspace and idle state', async () => {
  const { prepareConversationHandoff } = await import('../src/harness/handoff.mjs');
  const c=source(), state={conversations:[c]};
  assert.equal(prepareConversationHandoff(state,{handoffFrom:'source'},'/project',()=>false).sourceTaskId,'task1');
  assert.equal(prepareConversationHandoff(state,{},'/another',()=>false),null);
  assert.throws(()=>prepareConversationHandoff(state,{handoffFrom:'missing'},'/project',()=>false),/чат/i);
  assert.throws(()=>prepareConversationHandoff(state,{handoffFrom:'source'},'/another',()=>false),/проект/i);
  assert.throws(()=>prepareConversationHandoff(state,{handoffFrom:'source'},'/project',()=>true),/заверш|останов/i);
});

test('compact and native workers receive role and handoff instructions in real model requests', async () => {
  const { runCodeTask } = await import('../src/code-agent/run.mjs');
  for(const native of [false,true]) {
    let request;
    const client={supportsNativeTools:native, complete:async r=>{request=r;return {text:'{"tool":"finish","message":"готово"}'};}};
    await runCodeTask(client,{},'/tmp','поработаем?',null,{compactInitialPrompt:true,systemPrompt:'reviewer: verified handoff goal'});
    assert.match(native ? request.systemPrompt : request.prompt,/verified handoff goal/);
  }
});

test('ordinary chat sees the saved coding outcome without resuming uncertain actions',()=>{
 const c=source();delete c.handoff;
 assert.match(buildConversationPrompt('Что ты изменил?',c),/Fix the error|src\/app.mjs|Fixed parsing/);
 c.harnessTask.status='interrupted';c.harnessTask.checkpoint={phase:'executing_tool'};
 assert.match(buildConversationPrompt('Что произошло?',c),/interrupted/);
});
