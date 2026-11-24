import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConversationHarnessRunner } from '../src/harness/conversation-runner.mjs';
import { navigateQwenPage } from '../src/providers/qwen/browser-proxy.mjs';
import { createHarnessScheduler } from '../src/harness/scheduler.mjs';

for (const provider of ['qwen', 'deepseek', 'glm', 'chatgpt', 'googleai']) {
  test(`automatically continues the same ${provider} task from its latest checkpoint`, async () => {
    const conversation = { provider };
    const scheduler = createHarnessScheduler({ concurrency: 1 });
    let calls = 0, taskId;
    const waits = [];
    const run = createConversationHarnessRunner({ scheduler, persist() {}, retryDelaysMs: [1000, 2000], wait: async (ms, signal) => {
      waits.push(ms);
      assert.equal(scheduler.snapshot().active, 0);
      assert.equal(conversation.harnessTask.status, 'paused');
      assert.ok(conversation.harnessTask.nextResumeAt);
      assert.equal(signal?.aborted, false);
    }, runAgent: async (_client, _base, _workspace, _goal, _parent, options) => {
      if (++calls === 1) {
        taskId = conversation.harnessTask.id;
        options.onCheckpoint({ phase: 'awaiting_model', prompt: 'continue after completed tool', parentMessageId: 'r1' });
        throw Object.assign(new Error('quota'), { status: 429 });
      }
      assert.equal(conversation.harnessTask.id, taskId);
      assert.equal(options.resumeState.parentMessageId, 'r1');
      assert.equal(options.resumeState.prompt, 'continue after completed tool');
      return { message: 'done' };
    } });
    await run(conversation, {}, {}, '/project', 'fix', null, { signal: new AbortController().signal });
    assert.deepEqual(waits, [1000]);
    assert.equal(conversation.harnessTask.status, 'completed');
    assert.equal(conversation.harnessTask.autoResumeAttempts, 1);
    assert.equal(conversation.harnessTask.nextResumeAt, null);
  });
}

test('automatic continuation is bounded, respects provider delay and keeps the checkpoint after exhaustion', async () => {
  const conversation = { provider: 'qwen' };
  const waits = [];
  let calls = 0;
  const quota = Object.assign(new Error('quota'), { status: 429, retryAfterMs: 5000 });
  const run = createConversationHarnessRunner({ persist() {}, retryDelaysMs: [1000, 2000], wait: async ms => waits.push(ms), runAgent: async (_c, _b, _w, _g, _p, options) => {
    calls++;
    options.onCheckpoint({ phase: 'awaiting_model', prompt: 'saved' });
    throw quota;
  } });
  await assert.rejects(run(conversation, {}, {}, '/project', 'fix'), error => error === quota);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [5000, 5000]);
  assert.equal(conversation.harnessTask.status, 'paused');
  assert.equal(conversation.harnessTask.checkpoint.prompt, 'saved');
  assert.equal(conversation.harnessTask.nextResumeAt, null);
});

test('stop cancels automatic waiting without launching another worker', async () => {
  const controller = new AbortController();
  const conversation = { provider: 'glm' };
  let calls = 0;
  const run = createConversationHarnessRunner({ persist() {}, wait: async (_ms, signal) => {
    controller.abort(); signal.throwIfAborted();
  }, runAgent: async (_c, _b, _w, _g, _p, options) => {
    calls++;
    options.onCheckpoint({ phase: 'awaiting_model' });
    throw Object.assign(new Error('quota'), { status: 429 });
  } });
  await assert.rejects(run(conversation, {}, {}, '/project', 'fix', null, { signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(calls, 1);
  assert.equal(conversation.harnessTask.status, 'cancelled');
  assert.equal(conversation.harnessTask.nextResumeAt, null);
});

test('unknown delivery, running tools, auth and challenge do not trigger automatic replay', async () => {
  for (const [phase, error] of [
    ['awaiting_model', { code: 'ETIMEDOUT' }],
    ['awaiting_model', { code: 'DEEPSEEK_RATE_LIMIT' }],
    ['awaiting_model', { status: 429, delivery: 'accepted' }],
    ['awaiting_model', { status: 429, delivery: 'unknown' }],
    ['executing_tool', { status: 429 }],
    ['awaiting_model', { status: 401 }],
    ['awaiting_model', { code: 'QWEN_ANTIBOT_PUNISH' }],
  ]) {
    let calls = 0;
    const run = createConversationHarnessRunner({ persist() {}, wait: () => assert.fail('must not schedule'), runAgent: async (_c, _b, _w, _g, _p, options) => {
      calls++; options.onCheckpoint({ phase }); throw Object.assign(new Error('pause'), error);
    } });
    await assert.rejects(run({ provider: 'qwen' }, {}, {}, '/project', 'fix'), /pause/);
    assert.equal(calls, 1);
  }
});

test('a provider failure after failed verification retains the original error', async () => {
  const conversation = { provider: 'deepseek' };
  const original = new Error('transport failed');
  const run = createConversationHarnessRunner({ persist() {}, runAgent: async (_c, _b, _w, _g, _p, options) => {
    options.onTool({ tool: 'verify_task' }, { ok: false, verification: 'failed', checks: [] });
    throw original;
  } });
  await assert.rejects(run(conversation, {}, {}, '/project', 'fix'), error => error === original);
  assert.equal(conversation.harnessTask.status, 'failed');
  assert.equal(conversation.harnessTask.error.message, original.message);
});

test('automatic resume stops if the selected provider or workspace changes while waiting', async () => {
  for (const [field, value] of [['provider', 'changed'], ['workspace', 'changed'], ['workspace', '']]) {
    const conversation = { provider: 'qwen', workspace: '/project' };
    let calls = 0;
    const run = createConversationHarnessRunner({ persist() {}, wait: async () => { conversation[field] = value; }, runAgent: async (_c, _b, _w, _g, _p, options) => {
      calls++; options.onCheckpoint({ phase: 'awaiting_model' }); throw Object.assign(new Error('quota'), { status: 429 });
    } });
    await assert.rejects(run(conversation, {}, {}, '/project', 'fix'), error => error.code === 'HARNESS_CONTEXT_CHANGED');
    assert.equal(calls, 1);
  }
});

test('restart clears an in-process automatic wait instead of displaying a nonexistent timer', async () => {
  const { recoverHarnessTasks } = await import('../src/harness/task-state.mjs');
  const task = { schemaVersion: 1, status: 'paused', nextResumeAt: new Date().toISOString(), sequence: 1, events: [] };
  assert.equal(recoverHarnessTasks({ conversations: [{ harnessTask: task }] }), true);
  assert.equal(task.status, 'interrupted');
  assert.equal(task.nextResumeAt, null);
});

test('real worker automatically resumes after quota without repeating a completed file write', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { runCodeTask } = await import('../src/code-agent/run.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-auto-write-'));
  let calls = 0, writes = 0, checks = 0, waits = 0;
  try {
    const conversation = { provider: 'deepseek', workspace: root };
    const run = createConversationHarnessRunner({ runAgent: runCodeTask, persist() {}, wait: async () => waits++ });
    await run(conversation, { complete: async request => {
      calls++;
      if (calls === 1) return { text: '{"tool":"write_file","path":"notes.txt","content":"done"}', lastAssistantMessageId: 'r1' };
      if (calls === 2) throw Object.assign(new Error('quota'), { status: 429 });
      assert.equal(request.parentMessageId, 'r1');
      if (calls === 3) {
        assert.match(request.prompt, /notes.txt/);
        return { text: JSON.stringify({ tool: 'verify_task', checks: [{ cmd: 'node', args: ['-e', "if(require('node:fs').readFileSync('notes.txt','utf8')!=='done')process.exit(1)"] }] }) };
      }
      return { text: '{"tool":"finish","message":"done"}' };
    } }, {}, root, 'write notes.txt', null, { memoryEnabled: false, onTool: call => { if (call.tool === 'write_file') writes++; if (call.tool === 'verify_task') checks++; } });
    assert.equal(writes, 1);
    assert.equal(waits, 1);
    assert.equal(checks, 1);
    assert.equal(conversation.harnessTask.verification, 'passed');
    assert.equal(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8'), 'done');
    assert.equal(conversation.harnessTask.status, 'completed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('only transport failures explicitly marked not_sent are automatically continued', async () => {
  let calls = 0;
  const run = createConversationHarnessRunner({ persist() {}, wait: async () => {}, runAgent: async (_c, _b, _w, _g, _p, options) => {
    if (++calls === 1) {
      options.onCheckpoint({ phase: 'awaiting_model', prompt: 'pending' });
      throw Object.assign(new Error('not sent'), { code: 'ETIMEDOUT', delivery: 'not_sent' });
    }
    return {};
  } });
  await run({ provider: 'glm' }, {}, {}, '/project', 'fix');
  assert.equal(calls, 2);
});

test('a provider delay beyond the automatic wait limit is not shortened into an early resend', async () => {
  const run = createConversationHarnessRunner({ persist() {}, wait: () => assert.fail('must not wait or resend early'), runAgent: async (_c, _b, _w, _g, _p, options) => {
    options.onCheckpoint({ phase: 'awaiting_model' });
    throw Object.assign(new Error('long quota pause'), { status: 429, retryAfterMs: 2 * 60 * 60_000 });
  } });
  await assert.rejects(run({ provider: 'qwen' }, {}, {}, '/project', 'fix'), /long quota pause/);
});


test('Qwen navigation timeout automatically resumes the saved turn without auth, harvest or duplicate dispatch', async () => {
  const conversation = { provider: 'qwen' };
  let navigations = 0, sends = 0, recoveries = 0;
  const waits = [];
  const page = { async goto() {
    if (++navigations === 1) throw new Error('page.goto: NS_ERROR_NET_TIMEOUT');
  } };
  const client = { async recoverCheckpoint() { recoveries++; throw new Error('unsent turn needs no history recovery'); } };
  const run = createConversationHarnessRunner({ persist() {}, retryDelaysMs: [1000], wait: async ms => waits.push(ms),
    runAgent: async (_c, _b, _w, _g, _p, options) => {
      options.onCheckpoint({ phase: 'awaiting_model', prompt: 'saved tools and goal', parentMessageId: 'parent' });
      if (navigations) assert.equal(options.resumeState.prompt, 'saved tools and goal');
      await navigateQwenPage(page, 'https://chat.qwen.ai/c/chat');
      sends++;
      return { message: 'done' };
    },
  });
  await run(conversation, client, {}, '/project', 'fix');
  assert.deepEqual(waits, [1000]);
  assert.equal(navigations, 2);
  assert.equal(sends, 1);
  assert.equal(recoveries, 0);
  assert.equal(conversation.harnessTask.status, 'completed');
});
