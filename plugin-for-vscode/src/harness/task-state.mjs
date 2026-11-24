import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

export const RESUMABLE_TASK_STATUSES = new Set(['paused', 'interrupted', 'failed', 'cancelled']);
export const HARNESS_OWNER_INSTANCE_ID = randomUUID();

export function recordTaskEvent(task, type, data = {}) {
  task.sequence += 1;
  const event = { schemaVersion: 1, taskId: task.id, sequence: task.sequence,
    type, timestamp: new Date().toISOString(), data };
  task.updatedAt = event.timestamp;
  task.events.push(event);
  if (task.events.length > 100) task.events.splice(0, task.events.length - 100);
  return event;
}

export function createHarnessTask({ goal, provider = '', workspace = '', model = null }) {
  const task = { schemaVersion: 1, id: randomUUID(), goal, provider, workspace, model,
    status: 'created', checkpoint: null, plan: null, verification: 'not_run', sequence: 0,
    createdAt: new Date().toISOString(), events: [] };
  recordTaskEvent(task, 'task_created');
  return task;
}

export function isHarnessOwnerAlive(task) {
  if (!Number.isSafeInteger(task?.ownerPid) || task.ownerPid <= 0
    || (task.ownerHost && task.ownerHost !== hostname())) return false;
  if (task.ownerPid === process.pid && task.ownerInstanceId
    && task.ownerInstanceId !== HARNESS_OWNER_INSTANCE_ID) return false;
  try { process.kill(task.ownerPid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

export function recoverHarnessTasks(state) {
  let changed = false;
  for (const conversation of state.conversations || []) {
    const task = conversation.harnessTask;
    // Older workers saved a fatal verification result after the executing
    // checkpoint, but before a ready checkpoint. Only recorded completion is
    // recoverable; never repeat an action whose outcome is unknown.
    const [checkpointEvent, toolEvent, finishEvent] = task?.events?.slice(-3) || [];
    if (task?.status === 'failed' && !task.error && !task.failure
      && task.checkpoint?.phase === 'executing_tool' && !task.checkpoint.pendingToolResult
      && task.checkpoint.pendingAction?.tool === 'verify_task'
      && String(task.resultSummary || '').startsWith('Error:')
      && checkpointEvent?.type === 'checkpoint_saved' && toolEvent?.type === 'tool_finished'
      && toolEvent.data?.tool === 'verify_task' && toolEvent.data.ok === false
      && finishEvent?.type === 'task_finished' && finishEvent.data?.status === 'failed'
      && checkpointEvent.sequence < toolEvent.sequence && toolEvent.sequence < finishEvent.sequence) {
      const { pendingAction, ...checkpoint } = task.checkpoint;
      task.checkpoint = { ...checkpoint, phase: 'ready', prompt:
        `Tool result for verify_task:\n${JSON.stringify({ ok: false, fatal: true, error: task.resultSummary })}\nContinue the saved task using the current chat permissions. Inspect and verify the actual project; do not claim that checks passed.` };
      recordTaskEvent(task, 'checkpoint_saved', { reason: 'completed_verification_failure' });
      changed = true;
    }
    if (isHarnessOwnerAlive(task)) continue;
    if (task?.schemaVersion !== 1 || (!['created', 'queued', 'running'].includes(task.status)
      && !(task.status === 'paused' && task.nextResumeAt))) continue;
    task.status = 'interrupted';
    task.nextResumeAt = null;
    recordTaskEvent(task, 'task_interrupted', { reason: 'app_restart' });
    changed = true;
  }
  return changed;
}
