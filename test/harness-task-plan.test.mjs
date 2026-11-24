import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTaskPlan } from '../src/harness/task-plan.mjs';
import { getHarnessTaskView } from '../src/harness/task-view.mjs';
import { createHarnessTask } from '../src/harness/task-state.mjs';
import { createConversationHarnessRunner } from '../src/harness/conversation-runner.mjs';
import { conversationList } from '../src/state/conversations.mjs';

test('task plans require 1-12 unique explicit steps and at most one active step', () => {
  assert.equal(normalizeTaskPlan({ steps: [] }).ok, false);
  assert.equal(normalizeTaskPlan({ steps: Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, title: 'Step', status: 'pending' })) }).ok, false);
  assert.equal(normalizeTaskPlan({ steps: [{ id: 'x', title: 'One', status: 'pending' }, { id: 'x', title: 'Two', status: 'completed' }] }).ok, false);
  assert.equal(normalizeTaskPlan({ steps: [{ id: 'x', title: 'One', status: 'in_progress' }, { id: 'y', title: 'Two', status: 'in_progress' }] }).ok, false);
  assert.equal(normalizeTaskPlan({ steps: [{ id: 'x', title: 'One', status: 'mystery' }] }).ok, false);
});

test('runner persists plan updates and refuses task completion while steps remain', async () => {
  const conversation = { id: 'chat', provider: 'glm', workspace: '/project' };
  const saved = [];
  const run = createConversationHarnessRunner({ autoContinue: false, persist: event => saved.push(event.type),
    runAgent: async (_client, _base, _root, _goal, _parent, options) => {
      options.onTool({ tool: 'update_plan' }, { ok: true, plan: { steps: [
        { id: 'inspect', title: 'Inspect files', status: 'completed' },
        { id: 'change', title: 'Make change', status: 'in_progress' },
      ] } });
      return { message: 'Finished anyway' };
    } });
  const result = await run(conversation, {}, {}, '/project', 'multi-step work');
  assert.equal(conversation.harnessTask.plan.steps[1].status, 'in_progress');
  assert.ok(saved.includes('task_plan_updated'));
  assert.equal(result.failed, true);
  assert.match(result.message, /План задачи не завершён/);
  assert.equal(conversation.harnessTask.status, 'failed');
});

test('runner completes when the persisted plan has no remaining steps', async () => {
  const conversation = { provider: 'glm', workspace: '/project' };
  const run = createConversationHarnessRunner({ autoContinue: false, persist: () => {},
    runAgent: async (_client, _base, _root, _goal, _parent, options) => {
      options.onTool({ tool: 'update_plan' }, { ok: true, plan: { steps: [{ id: 'done', title: 'Done', status: 'completed' }] } });
      return { message: 'Done' };
    } });
  const result = await run(conversation, {}, {}, '/project', 'work');
  assert.equal(result.failed, undefined);
  assert.equal(conversation.harnessTask.status, 'completed');
});

test('runner exposes plan completeness and archives prior tasks once without checkpoint data', async () => {
  const conversation = { id: 'chat', provider: 'glm', workspace: '/project', messages: [] };
  const snapshots = [];
  const run = createConversationHarnessRunner({ autoContinue: false, persist: () => {},
    runAgent: async (_client, _base, _root, _goal, _parent, options) => {
      snapshots.push(options.isTaskPlanIncomplete());
      options.onTool({ tool: 'update_plan' }, { ok: true, plan: { steps: [{ id: 'one', title: 'One', status: 'pending' }] } });
      snapshots.push(options.isTaskPlanIncomplete());
      return { message: 'Done' };
    } });
  await run(conversation, {}, {}, '/project', 'first request');
  const firstTaskId = conversation.harnessTask.id;
  await run(conversation, {}, {}, '/project', 'second request');
  assert.deepEqual(snapshots, [false, true, false, true]);
  assert.equal(conversation.harnessHistory.length, 1);
  assert.equal(conversation.harnessHistory[0].id, firstTaskId);
  assert.equal('checkpoint' in conversation.harnessHistory[0], false);
  assert.deepEqual(conversationList({ conversations: [conversation] })[0].taskHistoryView.map(task => task.id), [firstTaskId]);
  conversation.harnessTask.status = 'paused';
  conversation.harnessTask.checkpoint = { phase: 'ready', prompt: 'resume' };
  await run(conversation, {}, {}, '/project', 'second request', null, { harnessResume: true });
  assert.equal(conversation.harnessHistory.length, 1);
  assert.deepEqual(snapshots, [false, true, false, true, true, true]);
});

test('conversation task history projection is capped to the latest 30 safe task summaries', () => {
  const conversation = { id: 'chat', messages: [], harnessHistory: Array.from({ length: 35 }, (_, index) => ({
    id: `task-${index}`, goal: `goal ${index}`, status: 'completed', provider: 'glm', workspace: '/project',
    verification: 'not_run', plan: { steps: [{ id: 'done', title: 'Complete', status: 'completed' }] }, secret: 'raw prompt',
  })) };
  const summary = conversationList({ conversations: [conversation] })[0];
  assert.equal(summary.taskHistoryView.length, 30);
  assert.equal(summary.taskHistoryView[0].id, 'task-5');
  assert.equal(JSON.stringify(summary.taskHistoryView).includes('raw prompt'), false);
});

test('runner retains the latest 30 completed task summaries in request order', async () => {
  const conversation = { id: 'chat', provider: 'glm', workspace: '/project' };
  const run = createConversationHarnessRunner({ autoContinue: false, persist: () => {}, runAgent: async () => ({ message: 'done' }) });
  for (let index = 0; index < 32; index++) await run(conversation, {}, {}, '/project', `request ${index}`);
  assert.equal(conversation.harnessHistory.length, 30);
  assert.equal(conversation.harnessHistory[0].goal, 'request 1');
  assert.equal(conversation.harnessHistory.at(-1).goal, 'request 30');
});

test('task plan projection is bounded and exposes only safe labels and statuses', () => {
  const task = createHarnessTask({ goal: 'work' });
  task.plan = { steps: [{ id: 'step-1', title: 'Read files', status: 'in_progress', secret: 'raw prompt' }] };
  const view = getHarnessTaskView({ harnessTask: task });
  assert.deepEqual(view.plan, [{ id: 'step-1', title: 'Read files', status: 'in_progress' }]);
  assert.equal(view.phase, null);
  assert.equal(JSON.stringify(view).includes('raw prompt'), false);
});

test('task progress projection reports only recognized checkpoint phases and tools', () => {
  const task = createHarnessTask({ goal: 'work' });
  task.checkpoint = { phase: 'executing_tool', pendingAction: { tool: 'write_file', content: 'private' } };
  const view = getHarnessTaskView({ harnessTask: task });
  assert.equal(view.phase, 'executing_tool');
  assert.equal(view.currentTool, 'write_file');
  task.checkpoint.pendingAction.tool = 'private_command';
  assert.equal(getHarnessTaskView({ harnessTask: task }).currentTool, null);
  task.checkpoint.phase = 'unexpected';
  assert.equal(getHarnessTaskView({ harnessTask: task }).phase, null);
});
