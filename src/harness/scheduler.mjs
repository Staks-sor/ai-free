import { AsyncLocalStorage } from 'node:async_hooks';
const workerContext = new AsyncLocalStorage();

export function waitWithoutHarnessSlot(work) {
  const worker = workerContext.getStore();
  return worker ? worker.suspend(work) : work();
}

function cancelled() {
  return Object.assign(new Error('Harness task cancelled while queued'), { name: 'AbortError' });
}

// Only active workers consume a slot. No polling, timer or child process is
// created for waiting tasks; cancellation removes their queue entry immediately.
export function createHarnessScheduler({ concurrency = 2, maxQueued = 16, now = () => performance.now() } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(maxQueued) || maxQueued < 1) {
    throw new TypeError('Harness concurrency and maxQueued must be positive integers');
  }
  let active = 0, waiting = 0;
  const queue = [];
  const full = () => Object.assign(new Error('Очередь агентов заполнена. Дождитесь завершения текущих задач.'), { code: 'HARNESS_QUEUE_FULL', delivery: 'not_sent' });
  function pump() {
    while (active < concurrency && queue.length) {
      const ticket = queue.shift();
      runtimeMetrics.record('queue_ms', now() - ticket.queuedAt);
      ticket.signal?.removeEventListener('abort', ticket.cancel);
      active++;
      ticket.start();
    }
  }
  function enqueue(start, reject, signal) {
    const ticket = { start, reject, signal, queuedAt: now() };
    ticket.cancel = () => {
      const index = queue.indexOf(ticket);
      if (index < 0) return;
      queue.splice(index, 1);
      runtimeMetrics.record('queue_cancelled_ms', now() - ticket.queuedAt);
      signal.removeEventListener('abort', ticket.cancel);
      reject(cancelled());
    };
    signal?.addEventListener('abort', ticket.cancel, { once: true });
    queue.push(ticket); pump();
  }
  function run(work, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(cancelled());
    if (queue.length + waiting >= maxQueued) return Promise.reject(full());
    return new Promise((resolve, reject) => {
      const worker = {
        held: false,
        release() { if (worker.held) { worker.held = false; active--; pump(); } },
        async suspend(wait) {
          if (!worker.held) throw new Error('Harness worker is already waiting');
          if (queue.length + waiting >= maxQueued) throw full();
          waiting++;
          worker.release();
          let value, failure;
          try { value = await wait(); } catch (error) { failure = error; }
          waiting--;
          signal?.throwIfAborted();
          await new Promise((resume, fail) => enqueue(() => { worker.held = true; resume(); }, fail, signal));
          if (failure) throw failure;
          return value;
        },
      };
      enqueue(() => {
        worker.held = true;
        Promise.resolve().then(() => workerContext.run(worker, work)).then(value => {
          worker.release(); resolve(value);
        }, error => {
          worker.release(); reject(error);
        });
      }, reject, signal);
    });
  }
  return { run, snapshot: () => ({ active, queued: queue.length + waiting, concurrency, maxQueued }) };
}
import { performance } from 'node:perf_hooks';
import { runtimeMetrics } from '../diagnostics/runtime-metrics.mjs';
