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

const DEFAULT_STALE_TASK_MS = 20 * 60 * 1000;
const runningTasks = new Map(); // conversationId → { startedAt, kind, label, staleAfterMs }

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
    console.warn(
      `[task-runner] clearing stale task ${task.kind} for ${conversationId} after ${Date.now() - task.startedAt}ms`,
    );
    runningTasks.delete(conversationId);
    return null;
  }
  return task;
}

// Запускает задачу в фоне. Если задача для этого conversationId уже идёт — бросает.
// taskFn получает AbortSignal — задача должна проверять signal.aborted и корректно
// завершаться при отмене (кнопка «Стоп»).
export function startTask(conversationId, kind, taskFn, label = "") {
  const existing = getFreshTask(conversationId);
  if (existing) {
    throw new Error(`Task ${existing.kind} already running for ${conversationId}`);
  }
  const controller = new AbortController();
  runningTasks.set(conversationId, {
    startedAt: Date.now(),
    kind,
    label,
    staleAfterMs: resolveStaleTaskMs(),
    controller,
  });

  // Fire-and-forget. .finally() гарантирует очистку даже при throw.
  Promise.resolve()
    .then(() => taskFn(controller.signal))
    .catch((err) => {
      console.error(`[task-runner] task ${kind} for ${conversationId} crashed:`, err);
    })
    .finally(() => {
      runningTasks.delete(conversationId);
    });
}

// Останавливает задачу: посылает abort и снимает её из списка активных.
// Возвращает true, если задача была и её отменили.
export function stopTask(conversationId) {
  const task = runningTasks.get(conversationId);
  if (!task) return false;
  try { task.controller?.abort(); } catch {}
  runningTasks.delete(conversationId);
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
