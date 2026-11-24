import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarnessTask, recordTaskEvent, recoverHarnessTasks } from '../src/harness/task-state.mjs';
import { createConversationHarnessRunner as createRunner } from '../src/harness/conversation-runner.mjs';
// These cases exercise explicit/manual continuation independently of the auto policy.
const createConversationHarnessRunner = options => createRunner({ ...options, autoContinue: false });
import { resolveConversationAgentTask } from '../src/window-app/agent-task.mjs';

for (const provider of ['qwen', 'deepseek', 'glm', 'chatgpt', 'googleai']) {
  test(`harness persists checkpoints and resumes the same ${provider} task`, async () => {
    let saved, calls = 0;
    const conversation = { id: 'chat', provider, workspace: '/project' };
    const run = createConversationHarnessRunner({
      persist: () => { saved = JSON.parse(JSON.stringify(conversation)); },
      runAgent: async (_client, _base, _root, goal, _parent, options) => {
        assert.equal(saved.harnessTask.status, 'running');
        assert.equal(goal, 'fix tests');
        if (++calls === 1) {
          options.onTool({ tool: 'read_file' }, { ok: true }, 'read file');
          options.onCheckpoint({ task: goal, prompt: 'continue after read', toolLogs: ['read file'], parentMessageId: 'reply-1' });
          throw Object.assign(new Error('limit'), { code: 'DEEPSEEK_RATE_LIMIT', delivery: 'rejected' });
        }
        assert.equal(options.resumeState.prompt, 'continue after read');
        assert.deepEqual(options.resumeState.toolLogs, ['read file']);
        return { message: 'done', toolLogs: ['read file'] };
      },
    });
    await assert.rejects(run(conversation, {}, {}, '/project', 'fix tests'), /limit/);
    const id = conversation.harnessTask.id;
    assert.equal(saved.harnessTask.status, 'paused');
    const input = resolveConversationAgentTask('продолжи', saved);
    assert.equal(input.task, 'fix tests');
    assert.equal(input.harnessResume, true);
    await run(conversation, {}, {}, '/project', input.task, null, { harnessResume: true });
    assert.equal(saved.harnessTask.id, id);
    assert.equal(saved.harnessTask.status, 'completed');
    assert.equal(saved.harnessTask.verification, 'not_run');
    assert.ok(saved.harnessTask.events.some(event => event.type === 'tool_finished'));
  });
}

test('recovery marks unfinished tasks interrupted without launching workers', () => {
  const task = createHarnessTask({ goal: 'fix', provider: 'qwen', workspace: '/project' });
  task.status = 'running';
  const state = JSON.parse(JSON.stringify({ conversations: [{ harnessTask: task }] }));
  assert.equal(recoverHarnessTasks(state), true);
  assert.equal(state.conversations[0].harnessTask.status, 'interrupted');
  assert.equal(recoverHarnessTasks(state), false);
});

test('events have a version and increasing sequence even after retention trims them', () => {
  const task = createHarnessTask({ goal: 'fix' });
  for (let index = 0; index < 120; index++) recordTaskEvent(task, 'checkpoint_saved');
  assert.equal(task.events.length, 100);
  assert.equal(task.events.at(-1).sequence, 121);
  assert.equal(task.events.at(-1).schemaVersion, 1);
});

test('new goals never reuse another task checkpoint', async () => {
  const conversation = { id: 'chat', provider: 'glm', workspace: '/project', harnessTask: createHarnessTask({ goal: 'old', provider: 'glm', workspace: '/project' }) };
  conversation.harnessTask.status = 'paused';
  conversation.harnessTask.checkpoint = { task: 'old', prompt: 'old prompt' };
  const previousId = conversation.harnessTask.id;
  const run = createConversationHarnessRunner({ persist: () => {}, runAgent: async (_c, _b, _w, _t, _p, options) => {
    assert.equal(options.resumeState, undefined);
    return { message: 'done' };
  } });
  await run(conversation, {}, {}, '/project', 'new');
  assert.notEqual(conversation.harnessTask.id, previousId);
});

test('awaiting user, failed result, and cancellation are not completed tasks', async () => {
  for (const [result, expected] of [[{ awaitingUser: true }, 'waiting_user'], [{ failed: true }, 'failed'], [{ stopped: true }, 'cancelled']]) {
    const conversation = { id: 'chat', provider: 'glm' };
    const run = createConversationHarnessRunner({ persist: () => {}, runAgent: async () => result });
    await run(conversation, {}, {}, '/project', 'fix');
    assert.equal(conversation.harnessTask.status, expected);
  }
});

test('resume refuses a checkpoint belonging to another provider or workspace', async () => {
  const conversation = { id: 'chat', provider: 'chatgpt', workspace: '/new', harnessTask: createHarnessTask({ goal: 'fix', provider: 'qwen', workspace: '/old' }) };
  conversation.harnessTask.status = 'paused';
  conversation.harnessTask.checkpoint = { prompt: 'old' };
  const run = createConversationHarnessRunner({ persist: () => {}, runAgent: () => assert.fail('must not run') });
  await assert.rejects(run(conversation, {}, {}, '/new', 'fix', null, { harnessResume: true }), /incompatible/i);
});

test('interrupted tool execution requires review instead of replaying a command', async () => {
  const conversation = { id: 'chat', provider: 'glm' };
  const task = createHarnessTask({ goal: 'fix', provider: 'glm', workspace: '/project' });
  task.status = 'interrupted';
  task.checkpoint = { phase: 'executing_tool', task: 'fix', prompt: 'old' };
  conversation.harnessTask = task;
  const run = createConversationHarnessRunner({ persist: () => {}, runAgent: () => assert.fail('must not replay') });
  await assert.rejects(run(conversation, {}, {}, '/project', 'fix', null, { harnessResume: true }), error => error.code === 'HARNESS_REVIEW_REQUIRED');
});

test('real worker checkpoints completed tools before the next model call and reports failed results', async () => {
  const { runCodeTask } = await import('../src/code-agent/run.mjs');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-harness-'));
  let checkpoint, calls = 0;
  try {
    const client = { complete: async () => {
      if (++calls === 1) return { text: '{"tool":"read_file","path":"notes.txt"}', lastAssistantMessageId: 'reply-1' };
      assert.equal(checkpoint.toolLogs.length, 1);
      throw Object.assign(new Error('limit'), { code: 'DEEPSEEK_RATE_LIMIT', delivery: 'rejected' });
    } };
    fs.writeFileSync(path.join(root, 'notes.txt'), 'hello');
    await assert.rejects(runCodeTask(client, {}, root, 'read notes', null, { memoryEnabled: false, onCheckpoint: value => { checkpoint = value; } }), /limit/);
    assert.match(checkpoint.prompt, /hello/);
    assert.equal(checkpoint.phase, 'awaiting_model');
    const result = await runCodeTask({ complete: async () => ({ text: '{"tool":"read_file","path":"notes.txt"}' }) }, {}, root, 'read notes', null, { memoryEnabled: false, maxToolSteps: 1 });
    assert.equal(result.failed, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unknown model delivery after restart is not blindly resubmitted', async () => {
  const conversation = { provider: 'googleai', harnessTask: createHarnessTask({ goal: 'fix', provider: 'googleai', workspace: '/project' }) };
  conversation.harnessTask.status = 'running';
  conversation.harnessTask.checkpoint = { phase: 'awaiting_model', prompt: 'pending request' };
  recoverHarnessTasks({ conversations: [conversation] });
  const run = createConversationHarnessRunner({ persist: () => {}, runAgent: () => assert.fail('must not resubmit') });
  await assert.rejects(run(conversation, {}, {}, '/project', 'fix', null, { harnessResume: true }), error => error.code === 'HARNESS_REVIEW_REQUIRED');
});

test('real worker resumes a serialized checkpoint without repeating a completed file read', async () => {
  const { runCodeTask } = await import('../src/code-agent/run.mjs');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-harness-restart-'));
  const file = path.join(root, 'state.json');
  let reads = 0, calls = 0;
  const conversation = { id: 'chat', provider: 'deepseek', workspace: root };
  const run = createConversationHarnessRunner({ runAgent: runCodeTask, persist: () => fs.writeFileSync(file, JSON.stringify(conversation)) });
  try {
    fs.writeFileSync(path.join(root, 'notes.txt'), 'checkpoint evidence');
    await assert.rejects(run(conversation, { complete: async () => {
      if (++calls === 1) return { text: '{"tool":"read_file","path":"notes.txt"}', lastAssistantMessageId: 'r1' };
      throw Object.assign(new Error('limit'), { code: 'DEEPSEEK_RATE_LIMIT', delivery: 'rejected' });
    } }, {}, root, 'read notes', null, { memoryEnabled: false, onTool: () => { reads++; } }), /limit/);
    const restored = JSON.parse(fs.readFileSync(file, 'utf8'));
    const id = restored.harnessTask.id;
    const resumeRun = createConversationHarnessRunner({ runAgent: runCodeTask, persist: () => {} });
    await resumeRun(restored, { complete: async request => {
      assert.match(request.prompt, /checkpoint evidence/);
      assert.equal(request.parentMessageId, 'r1');
      return { text: '{"tool":"finish","message":"done"}' };
    } }, {}, root, 'read notes', null, { harnessResume: true, memoryEnabled: false, onTool: () => { reads++; } });
    assert.equal(reads, 1);
    assert.equal(restored.harnessTask.id, id);
    assert.equal(restored.harnessTask.status, 'completed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a challenge pause resumes only when transport confirms no accepted request', async () => {
  for (const delivery of ['unknown', 'accepted', 'rejected', 'not_sent']) {
    const task = createHarnessTask({ goal: 'fix', provider: 'qwen', workspace: '/project' });
    Object.assign(task, { status: 'paused', pauseReason: 'challenge_required', failure: { kind: 'challenge_required', delivery }, checkpoint: { phase: 'awaiting_model' } });
    const conversation = { provider: 'qwen', harnessTask: task };
    let calls = 0;
    const run = createConversationHarnessRunner({ persist() {}, runAgent: async () => { calls++; return {}; } });
    if (['unknown', 'accepted'].includes(delivery)) {
      await assert.rejects(run(conversation, {}, {}, '/project', 'fix', null, { harnessResume: true }), error => error.code === 'HARNESS_REVIEW_REQUIRED');
      assert.equal(calls, 0);
    } else {
      await run(conversation, {}, {}, '/project', 'fix', null, { harnessResume: true });
      assert.equal(calls, 1);
      assert.equal(conversation.harnessTask.failure, null);
    }
  }
});


test('checkpoint persistence is awaited before the next model request', async () => {
  const { runCodeTask } = await import('../src/code-agent/run.mjs');
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  let modelCalls = 0;
  const conversation = { provider: 'deepseek' };
  const run = createConversationHarnessRunner({ runAgent: runCodeTask,
    persist: () => !release && conversation.harnessTask.events.at(-1).type === 'checkpoint_saved'
      ? new Promise(resolve => { release = resolve; started(); }) : undefined });
  const running = run(conversation, { complete: async () => {
    modelCalls++; return { text: '{"tool":"finish","message":"done"}' };
  } }, {}, '/project', 'finish', null, { memoryEnabled: false });
  await waiting;
  assert.equal(modelCalls, 0);
  release(); await running;
  assert.equal(modelCalls, 1);
});

test('a checkpoint write failure prevents a model request', async () => {
  const { runCodeTask } = await import('../src/code-agent/run.mjs');
  let calls = 0;
  const run = createConversationHarnessRunner({ runAgent: runCodeTask,
    persist: ({ type } = {}) => { if (type === 'checkpoint_saved') throw new Error('disk unavailable'); } });
  await assert.rejects(run({ provider: 'deepseek' }, { complete: async () => { calls++; } },
    {}, '/project', 'finish', null, { memoryEnabled: false }), /disk unavailable/);
  assert.equal(calls, 0);
});

test('a failed pre-tool checkpoint prevents a filesystem change', async () => {
  const { runCodeTask } = await import('../src/code-agent/run.mjs');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-checkpoint-tool-'));
  try {
    await assert.rejects(runCodeTask({ complete: async () => ({ text: '{"tool":"write_file","path":"never.txt","content":"no"}' }) },
      {}, root, 'write file', null, { memoryEnabled: false,
        onCheckpoint: async checkpoint => { if (checkpoint.phase === 'executing_tool') throw new Error('checkpoint failed'); },
      }), /checkpoint failed/);
    assert.equal(fs.existsSync(path.join(root, 'never.txt')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('startup leaves tasks owned by a live backend running', () => {
  const task = createHarnessTask({ goal: 'fix' }); Object.assign(task, { status: 'running', ownerPid: process.pid });
  assert.equal(recoverHarnessTasks({ conversations: [{ harnessTask: task }] }), false);
  assert.equal(task.status, 'running');
});

test('a second backend cannot start another worker for a live owned task', async () => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const child = spawn(process.execPath, ['-e', "process.stdin.resume(); process.stdout.write('ready');"], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  try {
    await once(child.stdout, 'data');
    const task = createHarnessTask({ goal: 'fix', provider: 'deepseek', workspace: '/project' });
    Object.assign(task, { status: 'running', ownerPid: child.pid });
    const conversation = { provider: 'deepseek', harnessTask: task };
    const run = createConversationHarnessRunner({ persist() {}, runAgent: () => assert.fail('duplicate worker') });
    await assert.rejects(run(conversation, {}, {}, '/project', 'new goal'), error => error.code === 'TASK_OWNED_BY_OTHER_PROCESS');
    assert.equal(recoverHarnessTasks({ conversations: [conversation] }), false);
    child.kill(); await exited;
    assert.equal(recoverHarnessTasks({ conversations: [conversation] }), true);
    assert.equal(task.status, 'interrupted');
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; } }
});

test('a previous process instance is recovered even if the OS reused its PID', () => {
  const task = createHarnessTask({ goal: 'fix' });
  Object.assign(task, { status:'running', ownerPid:process.pid, ownerInstanceId:'previous-instance' });
  assert.equal(recoverHarnessTasks({ conversations:[{ harnessTask:task }] }), true);
  assert.equal(task.status, 'interrupted');
});
