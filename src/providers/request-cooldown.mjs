import path from 'node:path';
import { AUTH_DIR } from '../config.mjs';
import { createRequestBudgetStore } from './request-budget-store.mjs';
import { parseRetryAfterMs } from './retry-after.mjs';

// No guessed quota or artificial spacing: only a confirmed provider restriction.
// The same disk protocol as Qwen, namespaced by provider/stable account ID.
export function createProviderCooldown({ provider, errorCode,
  root = process.env.SYNVOX_REQUEST_STATE_DIR
    || (process.env.NODE_TEST_CONTEXT ? null : path.join(AUTH_DIR, 'request-budgets')) }) {
  const store = createRequestBudgetStore(root, { until: 0 });
  const key = accountId => `${provider}/${String(accountId || 'default')}`;
  function assertAvailable(accountId = 'default', now = Date.now()) {
    try {
      const remaining = Math.max(0, store.read(key(accountId)).until - now);
      if (remaining > 0) throw Object.assign(new Error(`${provider}: действует пауза после ограничения провайдера. Новый запрос не отправлен.`),
        { code: errorCode, retryAfterMs: remaining, delivery: 'not_sent' });
    } catch (error) { error.delivery = 'not_sent'; throw error; }
  }
  function recordRateLimit(retryAfter, accountId = 'default', now = Date.now()) {
    const delay = parseRetryAfterMs(retryAfter, now) ?? 60_000;
    const state = store.update(key(accountId), state => { state.until = Math.max(state.until, now + delay); });
    return Math.max(0, state.until - now);
  }
  return { assertAvailable, recordRateLimit };
}
