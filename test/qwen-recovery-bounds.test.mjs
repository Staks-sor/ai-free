import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationHarnessRunner } from '../src/harness/conversation-runner.mjs';
import { createHarnessTask } from '../src/harness/task-state.mjs';

test('manual Continue resumes an unsent native UI failure from its saved checkpoint', async () => {
  const task = createHarnessTask({ goal: 'fix', provider: 'qwen', workspace: '/project' });
  Object.assign(task, { status: 'failed', failure: { kind: 'provider_error', code: 'QWEN_NATIVE_UI_UNAVAILABLE', delivery: 'not_sent' },
    checkpoint: { phase: 'awaiting_model', prompt: 'saved tool results', parentMessageId: 'parent' } });
  const conversation = { provider: 'qwen', workspace: '/project', harnessTask: task };
  let runs = 0;
  const runner = createConversationHarnessRunner({ persist() {}, autoContinue: false,
    runAgent: async (_c, _o, _w, _g, _p, options) => {
      runs++;
      assert.equal(options.resumeState.prompt, 'saved tool results');
      assert.equal(options.resumeState.parentMessageId, 'parent');
      return { message: 'done' };
    } });
  await runner(conversation, { recoverCheckpoint: () => assert.fail('unsent UI requires no history request') }, {}, '/project', 'fix', null, { harnessResume: true });
  assert.equal(runs, 1);
  assert.equal(task.status, 'completed');
});

for (const [code, expectedRuns] of [['QWEN_ANTIBOT_PUNISH', 1], ['QWEN_BROWSER_TRANSPORT_FAILURE', 3]]) {
  test(`${code}: absent history cannot bypass the automatic retry budget`, async () => {
    const conversation = { provider: 'qwen', workspace: '/project' };
    let runs = 0, failures = 0;
    const original = Object.assign(new Error('blocked saved turn'), { code, delivery: 'unknown' });
    const runner = createConversationHarnessRunner({ persist() {}, wait: async () => {},
      onFailure: (_conversation, error) => { failures++; assert.equal(error, original); },
      runAgent: async (_c, _o, _w, _g, _p, options) => {
        if (++runs > 3) throw new Error('unbounded replay');
        await options.onCheckpoint({ phase: 'awaiting_model', prompt: 'saved tool result', parentMessageId: 'parent' });
        throw original;
      },
    });
    await assert.rejects(runner(conversation, { recoverCheckpoint: async () => 'not_sent' }, {}, '/project', 'fix'), error => error === original);
    assert.equal(runs, expectedRuns);
    assert.equal(failures, expectedRuns);
    assert.equal(conversation.harnessTask.checkpoint.prompt, 'saved tool result');
    assert.equal(conversation.harnessTask.failure.delivery, 'not_sent');
    assert.equal(conversation.harnessTask.nextResumeAt, null);
  });
}

test('challenge controls are notified before history waiting and Stop settles the task', async () => {
  const conversation = { provider: 'qwen', workspace: '/project' };
  const controller = new AbortController();
  let notified = false, runs = 0;
  const runner = createConversationHarnessRunner({ persist() {},
    onFailure: () => { notified = true; },
    wait: async () => { assert.equal(notified, true); controller.abort(); controller.signal.throwIfAborted(); },
    runAgent: async (_c, _o, _w, _g, _p, options) => {
      runs++;
      await options.onCheckpoint({ phase: 'awaiting_model', prompt: 'saved' });
      throw Object.assign(new Error('challenge'), { code: 'QWEN_ANTIBOT_PUNISH', delivery: 'unknown' });
    },
  });
  await assert.rejects(runner(conversation, { recoverCheckpoint: async () => false }, {}, '/project', 'fix', null,
    { signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(runs, 1);
  assert.equal(conversation.harnessTask.status, 'cancelled');
  assert.equal(conversation.harnessTask.nextResumeAt, null);
  assert.equal(conversation.harnessTask.checkpoint.prompt, 'saved');
});
