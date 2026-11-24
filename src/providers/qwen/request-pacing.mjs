// Qwen dispatch has no automatic local challenge/empty-response cooldown.
// Only a server Retry-After deadline blocks a new request. Explicit spacing
// configuration remains optional; its default is zero.

/** Error code: Baxia punish page detected (antibot cooldown active). */
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { AUTH_DIR } from '../../config.mjs';
import { createRequestBudgetStore } from '../request-budget-store.mjs';
import { parseRetryAfterMs } from '../retry-after.mjs';
export { parseRetryAfterMs } from '../retry-after.mjs';
import { waitWithoutHarnessSlot } from '../../harness/scheduler.mjs';

export const QWEN_ANTIBOT_PUNISH = "QWEN_ANTIBOT_PUNISH";

const DEFAULT_MIN_INTERVAL_MS = 0;
const DEFAULT_PUNISH_COOLDOWN_MS = 0;

/** Дефолты экспортированы для тестов и документации. */
export function defaultMinIntervalMs() { return DEFAULT_MIN_INTERVAL_MS; }
export function defaultPunishCooldownMs() { return DEFAULT_PUNISH_COOLDOWN_MS; }

function numEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// --- punish page detection ------------------------------------------------

const PUNISH_MARKERS = [
  "_____tmd_____/punish",
  "_____tmd_____%2Fpunish",
  "/_____tmd_____/",
  "x5secdata=",
  "action=captcha",
  "showBaxiaCaptchaModal",
  "RGV587_ERROR",
];

/**
 * Короткая проверка ответа: это punish/капча-страница Baxia?
 * Принимает строку тела либо `{ contentType, text }`.
 */
export function isQwenPunishResponse(response) {
  if (response == null) return false;
  const body =
    typeof response === "string" ? response : String(response.text ?? "");
  if (body.length === 0) return false;
  // SSE-потоки начинаются с "data:"; punish всегда HTML/JSON.
  if (body.startsWith("data:")) return false;
  const head = body.length > 4096 ? body.slice(0, 4096) : body;
  return PUNISH_MARKERS.some((marker) => head.includes(marker));
}

/** Создать ошибку punish с человеческим объяснением. */
export function createQwenPunishError(cooldownMs, delivery = "unknown") {
  const err = new Error(
    "Qwen запросил проверку доступа. Если появилась капча, пройдите её вручную в SYNVOX. " +
      "Если капчи нет, это отклонённый запрос без доступной ручной проверки. Локальная пауза не устанавливается."
  );
  err.code = QWEN_ANTIBOT_PUNISH;
  err.cooldownMs = cooldownMs;
  err.delivery = delivery;
  return err;
}

// --- cooldown state -------------------------------------------------------

const initial = {
  punishUntil: 0, punishStreak: 0, lastCompletionAt: 0, emptyStreak: 0,
  penaltyMs: 0, successStreak: 0, restrictionRaisedAt: -1, lastDispatchAt: -1, retryAfterUntil: 0,
};
// Tests never mutate a user's real budget; process tests explicitly select a
// temporary directory. Desktop and plugin share AUTH_DIR by default.
let budgets = createRequestBudgetStore(process.env.SYNVOX_REQUEST_STATE_DIR
  || (process.env.NODE_TEST_CONTEXT ? null : path.join(AUTH_DIR, 'request-budgets')), initial);
const key = accountId => `qwen/${String(accountId || 'default')}`;
const pacingState = accountId => budgets.read(key(accountId));
const updatePacingState = (accountId, change) => budgets.update(key(accountId), change);

export function resetQwenPacingStateForTests() {
  budgets = createRequestBudgetStore(null, initial);
}

/**
 * Local challenge cooldowns are disabled; retained for transport callers.
 * @returns {number} остаток мс или 0.
 */
export function qwenAntibotCooldownRemainingMs(now = Date.now(), accountId = "default") {
  return 0;
}

// Совместимые алиасы.
export const getQwenAntibotCooldownRemaining = qwenAntibotCooldownRemainingMs;
export const registerQwenPunish = startQwenPunishCooldown;

/**
 * Throw only while a server Retry-After deadline is active.
 * @returns {boolean} false если кулдаун не активен.
 * @throws {Error} with code=QWEN_RATE_LIMIT and retryAfterMs.
 */
export function assertNoQwenAntibotCooldown(now = Date.now(), accountId = "default") {
  assertNoCooldown(pacingState(accountId), now);
  return false;
}

// Record a real challenge without inventing an expiry time.
export function startQwenPunishCooldown(now = Date.now(), accountId = "default") {
  const state = updatePacingState(accountId, state => {
    state.punishStreak += 1;
    state.punishUntil = 0;
    state.penaltyMs = 0;
    state.emptyStreak = 0;
  });
  return { punishStreak: state.punishStreak, backoffMs: 0 };
}

/** Успешный ответ: сбросить streak-и и снять кулдаун. */
export function registerQwenCompletionSuccess(now = Date.now(), accountId = "default", requestStartedAt = now) {
  updatePacingState(accountId, state => {
    if (requestStartedAt <= state.restrictionRaisedAt) return;
    if (++state.successStreak >= 3) {
      state.penaltyMs = state.penaltyMs <= resolveMinIntervalMs() / 2 ? 0 : state.penaltyMs / 2;
      state.successStreak = 0;
    }
    state.punishStreak = 0;
    state.emptyStreak = 0;
    if (state.punishUntil > now) state.punishUntil = now;
  });
}

/** Солвер капчи решил punish: немедленно снять кулдаун. */
export function clearQwenPunishCooldown(accountId = "default") {
  updatePacingState(accountId, state => {
    state.punishStreak = 0;
    state.emptyStreak = 0;
    state.punishUntil = 0;
  });
}

// --- empty-stream backoff ---------------------------------------------------

/**
 * Зафиксировать результат стрима. Пустые стримы подряд наращивают счётчик;
 * счётчик служит диагностике и не блокирует отправку.
 */
export function recordQwenStreamOutcome(wasEmpty, now = Date.now(), accountId = "default") {
  if (!wasEmpty) { registerQwenCompletionSuccess(now, accountId); return; }
  updatePacingState(accountId, state => { state.emptyStreak += 1; });
}

function resolveMinIntervalMs() {
  return numEnv('QWEN_COMPLETION_MIN_INTERVAL_MS', DEFAULT_MIN_INTERVAL_MS);
}

export function getQwenPacingIntervalMs(accountId = 'default') {
  return resolveMinIntervalMs();
}

// Pure reservation decision. A long completed turn naturally consumes its gap.
export function nextQwenCompletionSlot(now, nextAllowedAt, intervalMs) {
  const sendAt = Math.max(now, nextAllowedAt);
  return { waitMs: sendAt - now, nextAllowedAt: sendAt + intervalMs };
}

/** Текущая длина серии пустых стримов (для тестов/логов). */
export function getQwenEmptyStreak(accountId = "default") {
  return pacingState(accountId).emptyStreak;
}

// --- completion pacing -----------------------------------------------------

/**
 * Дождаться слота для POST /completions: если предыдущий запрос был меньше
 * чем QWEN_COMPLETION_MIN_INTERVAL_MS назад — спим остаток. Слот
 * резервируется сразу (на момент освобождения), чтобы параллельные вызовы
 * сериализовались.
 *
 * @param {{now?:()=>number, sleep?:(ms:number)=>Promise<void>}} [inject]
 * @returns {Promise<number>} сколько фактически ждали (мс).
 */
export async function waitForQwenCompletionSlot(inject = {}) {
  try { return await reserveQwenCompletionSlot(inject); }
  catch (error) { error.delivery = 'not_sent'; throw error; }
}

async function reserveQwenCompletionSlot(inject) {
  inject.signal?.throwIfAborted();
  const nowFn = typeof inject.now === 'function' ? inject.now
    : typeof inject.now === 'number' ? () => inject.now : () => Date.now();
  const sleep = inject.sleep ?? (ms => delay(ms, undefined, { signal: inject.signal || undefined }));
  assertNoQwenAntibotCooldown(nowFn(), inject.accountId);
  const start = nowFn();
  let reservation;
  updatePacingState(inject.accountId, state => {
    assertNoCooldown(state, start);
    const interval = resolveMinIntervalMs() <= 0 ? 0 : resolveMinIntervalMs();
    reservation = nextQwenCompletionSlot(start, interval > 0 ? state.lastCompletionAt : start, interval);
    state.lastCompletionAt = reservation.nextAllowedAt;
  });
  let waited = reservation.waitMs;
  if (waited > 0) await waitWithoutHarnessSlot(() => sleep(waited));
  if (inject.deferDispatch) return waited;
  return claimQwenDispatchSlot(inject, start, waited);
}

// Browser preparation/queues may outlast a reservation. Claim again only when
// the page is ready, without booking a second future reservation.
export async function waitForQwenDispatchSlot(inject = {}) {
  try {
    const start = typeof inject.now === 'function' ? inject.now() : inject.now ?? Date.now();
    return await claimQwenDispatchSlot(inject, start, 0);
  }
  catch (error) { error.delivery = 'not_sent'; throw error; }
}

async function claimQwenDispatchSlot(inject, start, waited) {
  const nowFn = typeof inject.now === 'function' ? inject.now
    : typeof inject.now === 'number' ? () => inject.now : () => Date.now();
  const sleep = inject.sleep ?? (ms => delay(ms, undefined, { signal: inject.signal || undefined }));
  for (;;) {
    inject.signal?.throwIfAborted();
    const now = inject.sleep ? Math.max(nowFn(), start + waited) : nowFn();
    let remaining = 0;
    updatePacingState(inject.accountId, state => {
      assertNoCooldown(state, now);
      const interval = resolveMinIntervalMs() <= 0 ? 0 : resolveMinIntervalMs();
      remaining = state.lastDispatchAt < 0 ? 0 : Math.max(0, state.lastDispatchAt + interval - now);
      if (!remaining) state.lastDispatchAt = now;
    });
    if (!remaining) return waited;
    await waitWithoutHarnessSlot(() => sleep(remaining));
    waited += remaining;
  }
}

function assertNoCooldown(state, now) {
  const remaining = Math.max(0, state.retryAfterUntil - now);
  if (remaining > 0) throw Object.assign(new Error('Qwen ограничил частоту запросов. Новый запрос не отправлен.'),
    { code: 'QWEN_RATE_LIMIT', retryAfterMs: remaining, delivery: 'not_sent' });
}

export function registerQwenRetryAfter(value, now = Date.now(), accountId = 'default') {
  const ms = parseRetryAfterMs(value, now) ?? 0;
  updatePacingState(accountId, state => { state.retryAfterUntil = Math.max(state.retryAfterUntil, now + ms); });
  return ms;
}
