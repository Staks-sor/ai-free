import assert from 'node:assert/strict';
import test from 'node:test';
import { runCodeTask } from '../src/code-agent/run.mjs';

test('a stopped Qwen model call saves its exact qwenTurn into the resumable checkpoint', async () => {
  const qwenTurn = { chatId: 'saved-chat', prompt: 'uploaded native prompt', parentMessageId: 'saved-parent',
    requestStartedAt: new Date().toISOString(), originalTransportClosed: true };
  const checkpoints = [];
  const result = await runCodeTask({ async complete() {
    throw Object.assign(new Error('user stopped after native request dispatch'), { name: 'AbortError', qwenTurn });
  } }, { sessionId: 'saved-chat' }, process.cwd(), 'resume the task', null, {
    memoryEnabled: false,
    onCheckpoint: checkpoint => { checkpoints.push(checkpoint); },
  });
  assert.equal(result.stopped, true);
  assert.deepEqual(checkpoints.at(-1).qwenTurn, qwenTurn);
});
