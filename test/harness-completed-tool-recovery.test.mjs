import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverHarnessTasks } from '../src/harness/task-state.mjs';
import { getHarnessTaskView } from '../src/harness/task-view.mjs';
function fixture() {
  return { provider: 'qwen', workspace: '/project', harnessTask: { schemaVersion: 1, id: 'task', goal: 'verify project', provider: 'qwen', workspace: '/project', status: 'failed', sequence: 4,
    resultSummary: 'Error: Команда "Godot" не разрешена.', error: null, failure: null,
    checkpoint: { phase: 'executing_tool', pendingAction: { tool: 'verify_task', checks: [{ cmd: 'Godot', args: ['--check-only'] }] }, prompt: 'old' },
    events: [{ sequence: 2, type: 'checkpoint_saved' }, { sequence: 3, type: 'tool_finished', data: { tool: 'verify_task', ok: false } }, { sequence: 4, type: 'task_finished', data: { status: 'failed' } }], verification: 'not_run' } };
}
test('recorded completed verification failures can resume after an access-mode change without replaying a tool', () => {
  const conversation = fixture();
  assert.equal(recoverHarnessTasks({ conversations: [conversation] }), true);
  assert.equal(conversation.harnessTask.checkpoint.phase, 'ready');
  assert.match(conversation.harnessTask.checkpoint.prompt, /Godot/);
  assert.equal(conversation.harnessTask.checkpoint.pendingAction, undefined);
  assert.equal(conversation.harnessTask.verification, 'not_run');
  assert.equal(getHarnessTaskView(conversation).canResume, true);
});
test('legacy recovery never guesses at unfinished tools, model delivery or missing evidence', () => {
  for (const patch of [
    { events: [] }, { resultSummary: 'unknown' }, { failure: { delivery: 'unknown' } }, { error: { code: 'crash' } },
    { checkpoint: { phase: 'executing_tool', pendingAction: { tool: 'write_file' } } },
    { events: [{ sequence: 3, type: 'tool_finished', data: { tool: 'read_file', ok: false } }, { sequence: 4, type: 'task_finished', data: { status: 'failed' } }] },
  ]) {
    const conversation = fixture(); Object.assign(conversation.harnessTask, patch);
    assert.equal(recoverHarnessTasks({ conversations: [conversation] }), false);
    assert.equal(conversation.harnessTask.checkpoint.phase, 'executing_tool');
  }
});
