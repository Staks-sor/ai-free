import assert from 'node:assert/strict';
import test from 'node:test';
import { createConversationHarnessRunner } from '../src/harness/conversation-runner.mjs';
import { createHarnessTask } from '../src/harness/task-state.mjs';
import { getHarnessTaskView } from '../src/harness/task-view.mjs';

function fixture({ provider = 'qwen', phase = 'awaiting_model', withTurn = true } = {}) {
  const task = createHarnessTask({ goal: 'resume the saved turn', provider, workspace: '/project', model: 'qwen-model' });
  Object.assign(task, {
    status: 'cancelled',
    failure: null,
    checkpoint: { phase, prompt: 'same saved prompt', parentMessageId: 'saved-parent',
      ...(withTurn ? { qwenTurn: { chatId: 'saved-chat', prompt: 'same saved prompt', parentMessageId: 'saved-parent', requestStartedAt: new Date().toISOString() } } : {}) },
  });
  return { id: 'chat', provider, workspace: '/project', model: 'qwen-model', harnessTask: task };
}

function runnerFor(recovery) {
  let runs = 0;
  const runner = createConversationHarnessRunner({ autoContinue: false, persist: () => {},
    runAgent: async () => { runs++; return { message: 'continued safely' }; } });
  const client = { async recoverCheckpoint(checkpoint) { return recovery(checkpoint); } };
  return { runner, client, get runs() { return runs; } };
}

test('cancelled Qwen awaiting-model checkpoint can offer a recovery-only continuation', () => {
  const conversation = fixture();
  const view = getHarnessTaskView(conversation);
  assert.equal(view.canResume, true);
});

test('unresolved stopped native turn performs history recovery only and requires review', async () => {
  const conversation = fixture();
  let reads = 0;
  const harness = runnerFor(async checkpoint => {
    reads++;
    assert.equal(checkpoint.qwenTurn.chatId, 'saved-chat');
    return false;
  });
  await assert.rejects(harness.runner(conversation, harness.client, { model: 'qwen-model', sessionId: 'saved-chat' },
    '/project', 'resume the saved turn', null, { harnessResume: true }), error => error.code === 'HARNESS_REVIEW_REQUIRED');
  assert.equal(reads, 1);
  assert.equal(harness.runs, 0);
});

test('cancelled Qwen checkpoint without qwenTurn may recover by exact prompt and parent, but unresolved history stays blocked', async () => {
  const conversation = fixture({ withTurn: false });
  assert.equal(getHarnessTaskView(conversation).canResume, true);
  let reads = 0;
  const harness = runnerFor(async checkpoint => {
    reads++;
    assert.equal(checkpoint.prompt, 'same saved prompt');
    assert.equal(checkpoint.parentMessageId, 'saved-parent');
    assert.equal(checkpoint.qwenTurn, undefined);
    return false;
  });
  await assert.rejects(harness.runner(conversation, harness.client, { model: 'qwen-model', sessionId: 'saved-chat' },
    '/project', 'resume the saved turn', null, { harnessResume: true }), error => error.code === 'HARNESS_REVIEW_REQUIRED');
  assert.equal(reads, 1);
  assert.equal(harness.runs, 0);
});

test('recovered stopped native turn resumes the task loop once', async () => {
  const conversation = fixture();
  const harness = runnerFor(async checkpoint => {
    assert.equal(checkpoint.qwenTurn.chatId, 'saved-chat');
    return true;
  });
  await harness.runner(conversation, harness.client, { model: 'qwen-model', sessionId: 'saved-chat' },
    '/project', 'resume the saved turn', null, { harnessResume: true });
  assert.equal(harness.runs, 1);
  assert.equal(conversation.harnessTask.status, 'completed');
});

test('proven not-sent stopped native turn resumes without duplicating the original request', async () => {
  const conversation = fixture();
  let reads = 0, runs = 0, notSentProofPersisted = false;
  const runner = createConversationHarnessRunner({ autoContinue: false,
    persist: ({ type, task }) => {
      if (type === 'checkpoint_saved' && task.failure?.delivery === 'not_sent') notSentProofPersisted = true;
    },
    runAgent: async () => { assert.equal(notSentProofPersisted, true); runs++; return { message: 'continued safely' }; },
  });
  const client = { async recoverCheckpoint() { reads++; return 'not_sent'; } };
  await runner(conversation, client, { model: 'qwen-model', sessionId: 'saved-chat' },
    '/project', 'resume the saved turn', null, { harnessResume: true });
  assert.equal(reads, 1);
  assert.equal(runs, 1);
  assert.equal(notSentProofPersisted, true);
});

test('other providers and interrupted tool execution remain blocked', async t => {
  for (const [provider, phase] of [['glm', 'awaiting_model'], ['qwen', 'executing_tool']]) {
    await t.test(`${provider}/${phase}`, async () => {
      const conversation = fixture({ provider, phase });
      assert.equal(getHarnessTaskView(conversation).canResume, false);
      let reads = 0;
      const harness = runnerFor(async () => { reads++; return true; });
      await assert.rejects(harness.runner(conversation, harness.client, { model: 'qwen-model', sessionId: 'saved-chat' },
        '/project', 'resume the saved turn', null, { harnessResume: true }), error => error.code === 'HARNESS_REVIEW_REQUIRED');
      assert.equal(reads, 0);
      assert.equal(harness.runs, 0);
    });
  }
});
