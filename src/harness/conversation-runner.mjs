import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { createHarnessTask, recordTaskEvent, RESUMABLE_TASK_STATUSES, isHarnessOwnerAlive, HARNESS_OWNER_INSTANCE_ID } from './task-state.mjs';
import { createHarnessScheduler } from './scheduler.mjs';
import { classifyProviderFailure } from './errors.mjs';
import { automaticResumeDelay } from './auto-continue.mjs';
import { getTaskPlanProgress, normalizeTaskPlan } from './task-plan.mjs';
import { getHarnessTaskView } from './task-view.mjs';

function pauseReason(error) {
  const failure = classifyProviderFailure(error);
  return failure.kind === 'rate_limited' ? 'rate_limit'
    : ['challenge_required', 'auth_required'].includes(failure.kind) ? failure.kind : null;
}

// Provider-specific auth and history recovery stay with adapters. A restart
// never sends a request; in-process continuation only reuses safe checkpoints.
export function createConversationHarnessRunner({ runAgent, persist, scheduler = createHarnessScheduler(),
  autoContinue = true, retryDelaysMs = [60_000, 120_000],
  wait = (ms, signal) => sleep(ms, undefined, { signal }), onAutoContinue = () => {}, onFailure = () => {} }) {
  return async function runConversationTask(conversation, client, baseOptions, workspace, goal, parent = null, options = {}) {
    const previous = conversation.harnessTask;
    if (previous?.ownerPid !== process.pid && isHarnessOwnerAlive(previous)
      && (['created', 'queued', 'running'].includes(previous.status) || previous.nextResumeAt)) {
      throw Object.assign(new Error('Задача выполняется в другом окне SYNVOX.'), { code: 'TASK_OWNED_BY_OTHER_PROCESS' });
    }
    const explicitResume = options.harnessResume === true;
    const retry = options.resumeState && previous?.goal === goal;
    const resume = explicitResume || retry;
    const provider = options.harnessProvider || conversation.provider || 'deepseek';
    const selectedWorkspace = conversation.workspace;
    if (resume && (!previous || previous.provider !== provider
      || previous.workspace !== workspace || previous.goal !== goal
      || !RESUMABLE_TASK_STATUSES.has(previous.status))) {
      throw new Error('Harness checkpoint is incompatible with this task, provider or workspace');
    }
    async function recoverSavedModel(task) {
      const stoppedNative = ['cancelled', 'interrupted'].includes(task.status)
        && Boolean(task.checkpoint?.prompt) && !['not_sent', 'rejected'].includes(task.failure?.delivery);
      const unknownFailure = task.failure?.delivery === 'unknown'
        && ['challenge_required', 'transport_error'].includes(task.failure.kind);
      if (provider !== 'qwen' || task.checkpoint?.phase !== 'awaiting_model'
        || (!unknownFailure && !stoppedNative) || typeof client.recoverCheckpoint !== 'function') return false;
      const originalTransportClosed = task.checkpoint.originalTransportClosed === true || !isHarnessOwnerAlive(task);
      task.checkpoint.originalTransportClosed = originalTransportClosed;
      task.checkpoint.recoveryNotBefore ||= task.checkpoint.qwenTurn?.requestStartedAt || task.updatedAt;
      const checkpoint = { ...task.checkpoint };
      const read = async () => {
        options.signal?.throwIfAborted();
        const result = await client.recoverCheckpoint(checkpoint, baseOptions);
        options.signal?.throwIfAborted();
        recordTaskEvent(task, 'model_recovery_checked', { outcome: result === true ? 'recovered' : result === 'not_sent' ? 'not_sent' : 'unresolved' });
        await persist({ type: 'checkpoint_saved', task });
        return result;
      };
      let recovered = await read();
      if (autoContinue && options.autoContinue !== false) {
        const delays = [15_000, 45_000, 120_000, 300_000];
        try {
          for (let index = 0; recovered === false && index < delays.length; index++) {
            task.ownerPid = process.pid;
            task.ownerInstanceId = HARNESS_OWNER_INSTANCE_ID;
            task.nextResumeAt = new Date(Date.now() + delays[index]).toISOString();
            recordTaskEvent(task, 'task_resume_scheduled', { recoveryOnly: true, attempt: index + 1 });
            onAutoContinue(conversation, { provider, waitMs: delays[index], attempt: index + 1, nextResumeAt: task.nextResumeAt, recoveryOnly: true });
            await persist({ type: 'task_resume_scheduled', task });
            await wait(delays[index], options.signal);
            options.signal?.throwIfAborted();
            if (conversation.harnessTask !== task || conversation.workspace !== selectedWorkspace) {
              throw Object.assign(new Error('Task context changed during recovery'), { code: 'HARNESS_CONTEXT_CHANGED' });
            }
            recovered = await read();
          }
        } catch (error) {
          task.status = options.signal?.aborted || error.name === 'AbortError' ? 'cancelled' : 'failed';
          throw error;
        } finally {
          task.nextResumeAt = null;
          await persist({ type: 'task_finished', task });
        }
      }
      if (recovered === 'not_sent') {
        task.failure ||= { kind: 'transport_error', code: 'QWEN_BROWSER_TRANSPORT_FAILURE', status: null };
        task.failure.delivery = 'not_sent';
        await persist({ type: 'checkpoint_saved', task });
      }
      return recovered;
    }
    const recoveredResponse = resume ? await recoverSavedModel(previous) : false;
    if (resume && (previous.checkpoint?.phase === 'executing_tool'
      || (!recoveredResponse && previous.checkpoint?.phase === 'awaiting_model'
        && previous.failure?.delivery !== 'not_sent'
        && ((!['rate_limit', 'auth_required', 'challenge_required'].includes(previous.pauseReason)
          && previous.failure?.kind !== 'transport_error')
          || (previous.failure && !['not_sent', 'rejected'].includes(previous.failure.delivery)))))) {
      throw Object.assign(new Error('Действие было прервано во время выполнения. Проверьте результат в проекте перед продолжением.'), { code: 'HARNESS_REVIEW_REQUIRED' });
    }
    if (!resume && previous?.id) {
      const view = getHarnessTaskView({ ...conversation, harnessTask: previous });
      conversation.harnessHistory = Array.isArray(conversation.harnessHistory) ? conversation.harnessHistory : [];
      conversation.harnessHistory = conversation.harnessHistory.filter(item => item?.id !== previous.id);
      conversation.harnessHistory.push({ id: view.id, goal: view.goal, status: view.status,
        provider: previous.provider || '', workspace: previous.workspace || '', verification: view.verification,
        verificationChecks: view.checks.map(({ name, ok, status, timedOut }) => ({ name, ok, status, timedOut })),
        changedFiles: view.changedFiles, plan: view.plan.length ? { steps: view.plan } : null });
      conversation.harnessHistory = conversation.harnessHistory.slice(-30);
    }
    const task = resume ? previous : createHarnessTask({ goal, provider, workspace, model: baseOptions?.model || conversation.model });
    task.ownerPid = process.pid;
    task.ownerInstanceId = HARNESS_OWNER_INSTANCE_ID;
    task.ownerHost = hostname();
    conversation.harnessTask = task;
    task.browserOnly = options.browserOnly === true;
    task.roleId = options.roleId || conversation.roleId || "assistant";
    task.skillId = options.skillId || null;
    task.changedFiles ||= [];
    task.verification = 'not_run';
    task.verificationChecks = [];
    task.autoResumeAttempts = 0;
    task.nextResumeAt = null;
    let checkpoint = options.resumeState || (resume ? task.checkpoint : undefined);
    const emit = (type, data = {}) => {
      task.sessionId = conversation.codeSessionId || baseOptions?.sessionId || null;
      task.accountId = conversation.providerAccountId || conversation.qwenCodeAccountId || null;
      recordTaskEvent(task, type, data);
      return persist({ type, task });
    };
    for (let attempt = 0; ; attempt++) {
      task.status = 'queued';
      task.error = null;
      task.failure = null;
      task.pauseReason = null;
      emit('task_queued');
      try {
        let result = await scheduler.run(() => {
          task.status = 'running';
          emit(resume || attempt ? 'task_resumed' : 'task_started', { automatic: attempt > 0 });
          return runAgent(client, baseOptions, workspace, goal, parent, {
            ...options,
            requireVerification: true,
            resumeState: checkpoint,
            onCheckpoint: checkpoint => {
              task.checkpoint = checkpoint;
              const callback = options.onCheckpoint?.(checkpoint);
              const saved = emit('checkpoint_saved');
              return Promise.all([callback, saved]);
            },
            isTaskPlanIncomplete: () => Boolean(task.plan && getTaskPlanProgress(task.plan).incomplete),
            onTool: (call, result, log) => {
              if (call.tool === 'update_plan' && result?.ok && result.plan) {
                const normalized = normalizeTaskPlan(result.plan);
                if (normalized.ok) {
                  task.plan = normalized.plan;
                  const progress = getTaskPlanProgress(task.plan);
                  emit('task_plan_updated', { total: progress.total, completed: progress.completed });
                }
              }
              if (call.tool === 'verify_task' && result?.verification) {
                task.verification = result.verification;
                task.verificationChecks = result.checks;
              } else if (['write_file', 'append_file', 'delete_file', 'delete_dir', 'mkdir', 'run_command', 'run_shell'].includes(call.tool)) {
                task.verification = 'not_run';
                task.verificationChecks = [];
              }
              if (['write_file', 'append_file', 'delete_file', 'delete_dir', 'mkdir'].includes(call.tool)
                && result?.ok !== false && !result?.error && typeof call.path === 'string'
                && task.changedFiles.length < 30 && !task.changedFiles.includes(call.path)) task.changedFiles.push(call.path.slice(0, 200));
              emit('tool_finished', { tool: call.tool, ok: result?.ok !== false && !result?.error });
              options.onTool?.(call, result, log);
            },
          });
        }, { signal: options.signal });
        if (task.verification === 'failed' && !result.stopped && !result.awaitingUser) {
          result = { ...result, failed: true, message: `${result.message || ''}\n\nПроверки не прошли. Задача требует исправления.` };
        }
        if (task.plan && getTaskPlanProgress(task.plan).incomplete && !result.stopped && !result.awaitingUser) {
          result = { ...result, failed: true, message: `${result.message || ''}\n\nПлан задачи не завершён. Обновите статусы оставшихся шагов и продолжите работу.` };
        }
        task.status = options.signal?.aborted || result.stopped ? 'cancelled'
          : result.awaitingUser ? 'waiting_user' : result.failed ? 'failed' : 'completed';
        task.resultSummary = String(result.message || '').slice(0, 1200);
        if (task.status === 'completed') task.checkpoint = null;
        await emit('task_finished', { status: task.status });
        return result;
      } catch (error) {
        if (provider === 'qwen' && task.checkpoint?.phase === 'awaiting_model' && error.qwenTurn) {
          task.checkpoint.qwenTurn = error.qwenTurn;
        }
        task.pauseReason = pauseReason(error);
        task.failure = classifyProviderFailure(error);
        task.status = options.signal?.aborted ? 'cancelled' : task.pauseReason ? 'paused' : 'failed';
        task.error = { code: error.code || 'TASK_FAILED', message: error.message, stack: error.stack };
        await onFailure(conversation, error);
        await emit('task_finished', { status: task.status, code: task.error.code, reason: task.pauseReason });
        if (await recoverSavedModel(task) === true) {
          checkpoint = task.checkpoint;
          continue;
        }
        const delay = autoContinue && options.autoContinue !== false && !options.signal?.aborted
          ? automaticResumeDelay(task, error, attempt, retryDelaysMs) : null;
        if (delay === null) throw error;
        task.status = 'paused';
        task.autoResumeAttempts = attempt + 1;
        task.nextResumeAt = new Date(Date.now() + delay).toISOString();
        onAutoContinue(conversation, { provider, waitMs: delay, attempt: attempt + 1, nextResumeAt: task.nextResumeAt });
        await emit('task_resume_scheduled', { waitMs: delay, attempt: attempt + 1, nextResumeAt: task.nextResumeAt });
        try {
          await wait(delay, options.signal);
          options.signal?.throwIfAborted();
          if (conversation.harnessTask !== task || (options.harnessProvider || conversation.provider || 'deepseek') !== provider
            || (conversation.workspace !== selectedWorkspace)) {
            throw Object.assign(new Error('Task context changed during automatic continuation'), { code: 'HARNESS_CONTEXT_CHANGED' });
          }
        } catch (waitError) {
          task.status = options.signal?.aborted || waitError.name === 'AbortError' ? 'cancelled' : 'failed';
          task.error = { code: waitError.code || 'AUTO_RESUME_FAILED', message: waitError.message, stack: waitError.stack };
          task.nextResumeAt = null;
          await emit('task_finished', { status: task.status, code: task.error.code });
          throw waitError;
        }
        task.nextResumeAt = null;
        checkpoint = task.checkpoint;
      }
    }
  };
}
