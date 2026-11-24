import { createHarnessScheduler } from '../harness/scheduler.mjs';
import { createFileLogger } from '../logging/logger.mjs';
import { withAccountActivitySession } from '../providers/activity-session.mjs';

const logger = createFileLogger({ component: 'browser-pool' });
const activityProviders = new Set(['qwen', 'glm', 'googleai', 'chatgpt']);

function activityKey(key) {
  const value = String(key);
  const separator = value.indexOf(':');
  const provider = separator < 0 ? value : value.slice(0, separator);
  if (!activityProviders.has(provider)) return null;
  const accountId = separator < 0 ? 'default' : value.slice(separator + 1) || 'default';
  return { provider, accountId };
}

// Background transports share two operation slots and at most two resident
// sessions; one idle session stays warm. Visible challenges are pinned.
export function createBrowserSessionPool({ limit = 2, idleMs = 300_000,
  onError = error => logger.error('browser.cleanup.failed', error) } = {}) {
  const scheduler = createHarnessScheduler({ concurrency: limit });
  const entries = new Map(), pinned = new Set();
  let serial = Promise.resolve();
  const locked = work => {
    const result = serial.then(work);
    serial = result.catch(() => {});
    return result;
  };
  async function remove(key) {
    const entry = entries.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    if (entry.active) await new Promise(resolve => entry.waiters.push(resolve));
    clearTimeout(entry.timer);
    try { await entry.session.close(); }
    catch (error) { idle(key, entry); throw error; }
    entries.delete(key);
  }
  function idle(key, entry) {
    clearTimeout(entry.timer);
    if (entry.active || pinned.has(key)) return;
    entry.timer = setTimeout(() => {
      locked(async () => {
        if (entries.get(key) === entry && !entry.active && !pinned.has(key)) await remove(key);
      }).catch(onError);
    }, idleMs);
    entry.timer.unref();
  }
  async function trimIdle() {
    const candidates = [...entries].filter(([key, entry]) => !pinned.has(key) && !entry.active)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    // Keep one warm background session; active and visible recovery sessions
    // never contribute to this idle allowance.
    for (const [key] of candidates.slice(0, -1)) await remove(key);
  }
  async function acquire(key, factory) {
    return locked(async () => {
      let entry = entries.get(key);
      if (!entry) {
        const background = [...entries].filter(([id]) => !pinned.has(id));
        if (!pinned.has(key) && background.length >= limit) {
          const candidate = background.filter(([, value]) => !value.active)
            .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
          if (!candidate) throw new Error('Browser admission has no idle session');
          await remove(candidate[0]);
        }
        const activity = activityKey(key);
        const session = activity
          ? await withAccountActivitySession(activity.provider, activity.accountId, factory)
          : await factory();
        entry = { session, active: 0, timer: null, lastUsed: Date.now(), waiters: [] };
        entries.set(key, entry);
      }
      clearTimeout(entry.timer);
      entry.active++;
      return entry;
    });
  }
  function proxy(key, factory, methods) {
    const facade = { close: () => locked(() => remove(key)) };
    for (const method of methods) facade[method] = (...args) => scheduler.run(async () => {
      args[0]?.signal?.throwIfAborted();
      const entry = await acquire(key, factory);
      try {
        args[0]?.signal?.throwIfAborted();
        return await entry.session[method](...args);
      } finally {
        entry.active--;
        entry.lastUsed = Date.now();
        if (!entry.active) entry.waiters.splice(0).forEach(resolve => resolve());
        idle(key, entry);
        await locked(trimIdle).catch(onError);
      }
    }, { signal: args[0]?.signal });
    return facade;
  }
  return {
    proxy,
    pin(key, value) {
      if (value) {
        pinned.add(key);
        const entry = entries.get(key);
        if (entry) idle(key, entry);
        return;
      }
      return locked(async () => {
        if (pinned.has(key) && entries.has(key)
          && [...entries.keys()].filter(id => !pinned.has(id)).length >= limit) await remove(key);
        pinned.delete(key);
        const entry = entries.get(key);
        if (entry) idle(key, entry);
        await trimIdle();
      });
    },
    closeAll: () => locked(async () => { for (const key of entries.keys()) await remove(key); pinned.clear(); }),
    snapshot: () => ({ ...scheduler.snapshot(), background: [...entries.keys()].filter(key => !pinned.has(key)).length,
      pinned: [...entries.keys()].filter(key => pinned.has(key)).length }),
  };
}

export const backgroundBrowserPool = createBrowserSessionPool();
