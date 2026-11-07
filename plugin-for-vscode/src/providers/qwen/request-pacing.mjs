/**
 * Qwen request pacing & anti-bot cooldown (Baxia punish protection).
 *
 * Проблема: серия быстрых POST /api/v2/chat/completions (агентные tool-loop
 * запросы) разгоняет риск-скоринг Baxia. Endpoint начинает отдавать
 * punish-страницу (HTML 200 с `_____tmd_____/punish`) вместо SSE-потока.
 * Клиент видит «пустой стрим», мгновенно создаёт новый чат и повторяет —
 * чем ещё сильнее греет скоринг.
 *
 * Три механизма:
 *  1. Pacing — минимальный интервал между POST /completions.
 *  2. Empty-stream backoff — серия пустых стримов => короткий кулдаун.
 *  3. Punish detection — punish-страница => экспоненциальный кулдаун,
 *     ошибка наружу с внятным сообщением.
 */

/** Error code: Baxia punish page detected (antibot cooldown active). */
export const QWEN_ANTIBOT_PUNISH = "QWEN_ANTIBOT_PUNISH";

const DEFAULT_MIN_INTERVAL_MS = 4_000;      // 4 c между POST по умолчанию
const DEFAULT_EMPTY_BACKOFF_MS = 60_000;
const DEFAULT_PUNISH_COOLDOWN_MS = 600_000; // база: 10 минут
const DEFAULT_PUNISH_COOLDOWN_MAX_MS = 1_800_000; // потолок: 30 минут
const DEFAULT_EMPTY_STREAK_THRESHOLD = 3;

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
export function createQwenPunishError(cooldownMs) {
  const seconds = Math.ceil((cooldownMs ?? 0) / 1000);
  const err = new Error(
    `Qwen Baxia antibot punish (captcha). Cooldown ~${seconds}s. ` +
      `Решите капчу в окне браузера ai-free или подождите. ` +
      `Снизить частоту: QWEN_COMPLETION_MIN_INTERVAL_MS (например 5000).`
  );
  err.code = QWEN_ANTIBOT_PUNISH;
  err.cooldownMs = cooldownMs;
  return err;
}

// --- cooldown state -------------------------------------------------------
//
// Состояние PER-ACCOUNT: Baxia карает браузерный профиль аккаунта (у каждого
// свой browser-profile-N), а не пул целиком. Глобальный лок лочил все
// аккаунты сразу и убивал ротацию: punish на одном аккаунте мгновенно валил
// запросы ко всем остальным (инцидент 2026-09-15: 600s -> 1200s эскалация).
// lastCompletionAt остаётся глобальным: сериализация POST-ов пула снижает
// риск-скоринг.

const accountPacing = new Map(); // accountId -> { punishUntil, punishStreak, emptyStreak }
let lastCompletionAt = 0;
// Пулевая блокировка (IP-level punish): когда Baxia карает НЕ профиль, а
// IP/браузер целиком, ротация только разгоняет шторм — каждый свитч = новый
// запрос в активный punish (+600s аккаунту, эскалация до 1800s). Второй
// подряд punish на разных аккаунтах включает общий кулдаун на весь пул.
let poolPunishUntil = 0;

function pacingStateFor(accountId = "default") {
  let state = accountPacing.get(accountId);
  if (!state) {
    state = { punishUntil: 0, punishStreak: 0, emptyStreak: 0 };
    accountPacing.set(accountId, state);
  }
  return state;
}

/** Сброс состояния (только для тестов). */
export function resetQwenPacingStateForTests() {
  accountPacing.clear();
  lastCompletionAt = 0;
  poolPunishUntil = 0;
}

/**
 * Включить пулевую блокировку всех аккаунтов (IP-punish breaker).
 * Длительность QWEN_POOL_PUNISH_COOLDOWN_MS (по умолчанию 300с — короче
 * индивидуальных 600с, чтобы хвостом управляли per-account кулдауны).
 * @returns {number} длительность мс.
 */
export function startQwenPoolPunishCooldown(now = Date.now()) {
  const ms = numEnv("QWEN_POOL_PUNISH_COOLDOWN_MS", 300_000);
  poolPunishUntil = Math.max(poolPunishUntil, now + ms);
  return ms;
}

function resolvePunishCooldownMs() {
  return numEnv("QWEN_PUNISH_COOLDOWN_MS", DEFAULT_PUNISH_COOLDOWN_MS);
}

function resolvePunishCooldownMaxMs() {
  return numEnv(
    "QWEN_PUNISH_COOLDOWN_MAX_MS",
    DEFAULT_PUNISH_COOLDOWN_MAX_MS
  );
}

/**
 * Активен ли антибот-кулдаун аккаунта.
 * @returns {number} остаток мс или 0.
 */
export function qwenAntibotCooldownRemainingMs(now = Date.now(), accountId = "default") {
  return Math.max(poolPunishUntil - now, pacingStateFor(accountId).punishUntil - now, 0);
}

// Совместимые алиасы.
export const getQwenAntibotCooldownRemaining = qwenAntibotCooldownRemainingMs;
export const registerQwenPunish = startQwenPunishCooldown;

/**
 * Бросить, если антибот-кулдаун аккаунта активен.
 * @returns {boolean} false если кулдаун не активен.
 * @throws {Error} с code=QWEN_ANTIBOT_PUNISH и cooldownRemainingMs.
 */
export function assertNoQwenAntibotCooldown(now = Date.now(), accountId = "default") {
  const remaining = qwenAntibotCooldownRemainingMs(now, accountId);
  if (remaining <= 0) return false;
  const err = createQwenPunishError(remaining);
  err.cooldownRemainingMs = remaining;
  throw err;
}

// Зарегистрировать punish: экспоненциальный бэкофф с потолком (per-account).
export function startQwenPunishCooldown(now = Date.now(), accountId = "default") {
  const state = pacingStateFor(accountId);
  const base = resolvePunishCooldownMs();
  const cap = Math.max(resolvePunishCooldownMaxMs(), base);
  state.punishStreak += 1;
  const backoffMs = Math.min(base * 2 ** (state.punishStreak - 1), cap);
  state.punishUntil = Math.max(state.punishUntil, now + backoffMs);
  state.emptyStreak = 0;
  return { punishStreak: state.punishStreak, backoffMs };
}

/** Успешный ответ: сбросить streak-и и снять кулдаун аккаунта. */
export function registerQwenCompletionSuccess(now = Date.now(), accountId = "default") {
  const state = pacingStateFor(accountId);
  state.punishStreak = 0;
  state.emptyStreak = 0;
  if (state.punishUntil > now) state.punishUntil = now;
}

/**
 * Солвер капчи решил punish: снять кулдаун. Без accountId — все аккаунты
 * (ручное решение капчи в окне исторически чистило глобально).
 */
export function clearQwenPunishCooldown(accountId = null) {
  if (accountId == null) {
    for (const state of accountPacing.values()) {
      state.punishStreak = 0;
      state.emptyStreak = 0;
      state.punishUntil = 0;
    }
    poolPunishUntil = 0;
    return;
  }
  const state = accountPacing.get(accountId);
  if (!state) return;
  state.punishStreak = 0;
  state.emptyStreak = 0;
  state.punishUntil = 0;
}

// --- empty-stream backoff ---------------------------------------------------

/**
 * Зафиксировать результат стрима аккаунта. Пустые стримы подряд наращивают
 * счётчик; при достижении порога включается короткий кулдаун аккаунта,
 * счётчик сбрасывается.
 */
export function recordQwenStreamOutcome(wasEmpty, now = Date.now(), accountId = "default") {
  const state = pacingStateFor(accountId);
  if (wasEmpty) {
    state.emptyStreak += 1;
    if (state.emptyStreak >= emptyStreakThreshold()) {
      const backoff = resolveEmptyBackoffMs();
      state.punishUntil = Math.max(state.punishUntil, now + backoff);
      state.emptyStreak = 0;
    }
    return;
  }
  registerQwenCompletionSuccess(now, accountId);
}

function emptyStreakThreshold() {
  return numEnv("QWEN_EMPTY_STREAK_LIMIT", DEFAULT_EMPTY_STREAK_THRESHOLD);
}

function resolveEmptyBackoffMs() {
  return numEnv("QWEN_EMPTY_BACKOFF_MS", DEFAULT_EMPTY_BACKOFF_MS);
}

/** Текущая длина серии пустых стримов (для тестов/логов). */
export function getQwenEmptyStreak() {
  return emptyStreak;
}

// --- completion pacing -----------------------------------------------------

/**
 * Дождаться слота для POST /completions: если предыдущий запрос был меньше
 * чем QWEN_COMPLETION_MIN_INTERVAL_MS назад — спим остаток. Слот
 * резервируется сразу (на момент освобождения), чтобы параллельные вызовы
 * сериализовались. Кулдаун-проверка — per-account (inject.accountId).
 *
 * @param {{now?:()|number, sleep?:(ms:number)=>Promise<void>, accountId?:string}} [inject]
 * @returns {Promise<number>} сколько фактически ждали (мс).
 */
export async function waitForQwenCompletionSlot(inject = {}) {
  // now может быть функцией (динамическое время) или числом (фиксированный
  // момент — удобно для тестов и детерминированных вызовов).
  const nowFn =
    typeof inject.now === "function"
      ? inject.now
      : typeof inject.now === "number"
        ? () => inject.now
        : () => Date.now();
  const sleep = inject.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  // Punish-wait (инцидент 06.11 18:00): Hermes ретраил запрос во время
  // пулевого кулдауна, и каждый ретрай мгновенно получал stream_error
  // «Cooldown ~216s» — тающий остаток, отданный ошибкой в лицо (4 подряд
  // в TG). Если остаток кулдауна укладывается в бюджет ожидания
  // QWEN_PUNISH_WAIT_MAX_MS (по умолчанию 300с — ровно пулевый кулдаун),
  // ЖДЁМ до конца и продолжаем как ни в чём не бывало. Ошибку бросаем
  // только если остаток дольше бюджета (эскалация 600с+ — ждать весь
  // ход бессмысленно, клиент должен знать).
  const waitBudgetMs = numEnv("QWEN_PUNISH_WAIT_MAX_MS", 300_000);
  let punishWaitedMs = 0;
  let cooldownLeft = qwenAntibotCooldownRemainingMs(nowFn(), inject.accountId);
  if (cooldownLeft > 0) {
    if (cooldownLeft > waitBudgetMs) {
      await assertNoQwenAntibotCooldown(nowFn(), inject.accountId); // бросит с человеческим текстом
    }
    console.log(`[qwen-proxy] antibot cooldown active (${Math.round(cooldownLeft / 1000)}s) — waiting it out instead of failing (budget ${Math.round(waitBudgetMs / 1000)}s)`);
    while (cooldownLeft > 0) {
      const chunk = Math.min(cooldownLeft, 5_000);
      const before = nowFn();
      await sleep(chunk);
      punishWaitedMs += Math.max(0, nowFn() - before);
      cooldownLeft = qwenAntibotCooldownRemainingMs(nowFn(), inject.accountId);
      // Ручное решение капчи в окне (clearQwenPunishCooldown) подхватится
      // здесь мгновенно: остаток обнулится раньше таймера.
    }
  }

  await assertNoQwenAntibotCooldown(nowFn(), inject.accountId);

  const minInterval = numEnv(
    "QWEN_COMPLETION_MIN_INTERVAL_MS",
    DEFAULT_MIN_INTERVAL_MS
  );
  if (minInterval <= 0) {
    lastCompletionAt = nowFn();
    return 0;
  }

  const start = nowFn();
  // Момент фактической отправки: не раньше прихода и не раньше
  // предыдущего резерва (prev send + interval). Конкурентные вызовы
  // автоматически сериализуются за счёт сдвига резерва в будущее.
  const sendAt = Math.max(start, lastCompletionAt);
  const waitMs = sendAt - start;
  lastCompletionAt = sendAt + minInterval;
  if (waitMs > 0) await sleep(waitMs);
  return waitMs + punishWaitedMs;
}
