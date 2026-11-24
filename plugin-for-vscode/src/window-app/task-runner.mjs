// In-memory очередь долгих задач (например, /code-агент 10-60 сек).
//
// Зачем: чтобы UI не блокировался, пока выполняется задача в одном чате.
// Юзер может переключиться в другой чат и запустить там вторую задачу.
//
// Жизненный цикл:
//   1. POST /messages со /code → server.startTask(conversationId, "code", taskFn)
//   2. taskFn запускается в фоне (fire-and-forget Promise)
//   3. UI делает polling GET /api/state каждую секунду, видит running: true
//   4. Когда taskFn завершается — running удаляется из Map, UI видит готовое сообщение
//
// Состояние НЕ персистится — при рестарте сервера задачи теряются (это OK для MVP).

import { createFileLogger } from "../logging/logger.mjs";
import { createTaskTrace } from "../logging/task-trace.mjs";

const DEFAULT_STALE_TASK_MS = 20 * 60 * 1000;
const runningTasks = new Map(); // conversationId → { startedAt, kind, label, staleAfterMs }
let acceptingTasks = true;
const taskLogger = createFileLogger({ component: "task-runner" });

function resolveStaleTaskMs(value) {
  const parsed = Number(value ?? process.env.AI_FREE_TASK_STALE_MS ?? DEFAULT_STALE_TASK_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_STALE_TASK_MS;
  return Math.min(Math.max(Math.floor(parsed), 60_000), 60 * 60 * 1000);
}

function isTaskStale(task) {
  if (!task) return false;
  return Date.now() - task.startedAt > task.staleAfterMs;
}

function getFreshTask(conversationId) {
  const task = runningTasks.get(conversationId);
  if (!task) return null;
  if (isTaskStale(task)) {
    if (!task.staleDetected) {
      task.staleDetected = true;
      taskLogger.warn("background_task.stale", {
        conversationId,
        kind: task.kind,
        durationMs: Date.now() - task.startedAt,
      });
      console.warn(
        `[task-runner] aborting stale task ${task.kind} for ${conversationId} after ${Date.now() - task.startedAt}ms`,
      );
      task.controller.abort();
    }
  }
  return task;
}

// A confirmed provider wait is active work, not an abandoned task. Keep its
// cancellation controller reachable through the existing Stop button.
export function extendTaskWait(conversationId, waitMs) {
  const task = runningTasks.get(conversationId);
  if (!task) return false;
  task.staleAfterMs = Math.max(task.staleAfterMs, Date.now() - task.startedAt + waitMs + DEFAULT_STALE_TASK_MS);
  return true;
}

// Запускает задачу в фоне. Если задача для этого conversationId уже идёт — бросает.
// taskFn получает AbortSignal — задача должна проверять signal.aborted и корректно
// завершаться при отмене (кнопка «Стоп»).
export function startTask(conversationId, kind, taskFn, label = "", traceContext = {}) {
  if (!acceptingTasks) throw Object.assign(new Error("Программа завершает работу; новые задачи не принимаются."), { code: "APP_SHUTTING_DOWN" });
  const existing = getFreshTask(conversationId);
  if (existing) {
    throw new Error(`Task ${existing.kind} already running for ${conversationId}`);
  }
  const controller = new AbortController();
  const startedAt = Date.now();
  const trace = createTaskTrace({
    logger: taskLogger,
    conversationId,
    agentId: conversationId,
    ...traceContext,
  });
  trace.record("task_created", { kind, label });
  const task = {
    startedAt,
    kind,
    label,
    staleAfterMs: resolveStaleTaskMs(traceContext.staleAfterMs),
    controller,
    trace,
  };
  runningTasks.set(conversationId, task);
  taskLogger.info("background_task.start", { conversationId, kind, label });
  trace.record("task_started", { kind, label });

  // Fire-and-forget. .finally() гарантирует очистку даже при throw.
  task.completion = Promise.resolve()
    .then(() => taskFn(controller.signal))
    .then(() => {
      trace.finish(controller.signal.aborted ? "cancelled" : "success");
      taskLogger.info("background_task.success", {
        conversationId,
        kind,
        label,
        durationMs: Date.now() - startedAt,
      });
    })
    .catch((err) => {
      trace.finish(controller.signal.aborted ? "cancelled" : "error", {
        errorCode: err?.code || err?.name || "TASK_FAILED",
      });
      taskLogger.error("background_task.error", err, {
        conversationId,
        kind,
        label,
        durationMs: Date.now() - startedAt,
      });
      console.error(`[task-runner] task ${kind} for ${conversationId} crashed:`, err);
    })
    .finally(() => {
      if (runningTasks.get(conversationId) === task) {
        runningTasks.delete(conversationId);
      }
    });
}

// Останавливает задачу: посылает abort. Слот освобождается после завершения taskFn.
// Возвращает true, если задача была и её отменили.
export function stopTask(conversationId) {
  const task = runningTasks.get(conversationId);
  if (!task) return false;
  if (!task.cancelRequested) {
    task.cancelRequested = true;
    try { task.controller?.abort(); } catch {}
    taskLogger.info("background_task.stop", {
      conversationId,
      kind: task.kind,
      durationMs: Date.now() - task.startedAt,
    });
  }
  return true;
}

// AbortSignal текущей задачи (или null) — для проброса в долгие операции.
export function getTaskSignal(conversationId) {
  return getFreshTask(conversationId)?.controller?.signal || null;
}

// true если для conversationId есть задача в работе.
export function isRunning(conversationId) {
  return Boolean(getFreshTask(conversationId));
}

// Возвращает мета-инфо о задаче (или null).
export function getTaskInfo(conversationId) {
  return getFreshTask(conversationId);
}

// Список ID всех активных задач — для UI чтобы показать индикаторы.
export function getRunningIds() {
  return [...runningTasks.keys()].filter((id) => Boolean(getFreshTask(id)));
}

export function stopAllTasks({ shutdown = false } = {}) {
  if (shutdown) acceptingTasks = false;
  let count = 0;
  for (const id of [...runningTasks.keys()]) {
    if (stopTask(id)) count += 1;
  }
  return count;
}

export async function waitForAllTasks({ timeoutMs = 5000 } = {}) {
  const completions = [...runningTasks.values()].map(task => task.completion);
  if (!completions.length) return true;
  let timer;
  try {
    return await Promise.race([
      Promise.allSettled(completions).then(() => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
