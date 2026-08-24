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

let punishUntil = 0;
let punishStreak = 0;
let lastCompletionAt = 0;
let emptyStreak = 0;

/** Сброс состояния (только для тестов). */
export function resetQwenPacingStateForTests() {
  punishUntil = 0;
  punishStreak = 0;
  lastCompletionAt = 0;
  emptyStreak = 0;
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
 * Активен ли антибот-кулдаун.
 * @returns {number} остаток мс или 0.
 */
export function qwenAntibotCooldownRemainingMs(now = Date.now()) {
  return Math.max(0, punishUntil - now);
}

// Совместимые алиасы.
export const getQwenAntibotCooldownRemaining = qwenAntibotCooldownRemainingMs;
export const registerQwenPunish = startQwenPunishCooldown;

/**
 * Бросить, если антибот-кулдаун активен.
 * @returns {boolean} false если кулдаун не активен.
 * @throws {Error} с code=QWEN_ANTIBOT_PUNISH и cooldownRemainingMs.
 */
export function assertNoQwenAntibotCooldown(now = Date.now()) {
  const remaining = qwenAntibotCooldownRemainingMs(now);
  if (remaining <= 0) return false;
  const err = createQwenPunishError(remaining);
  err.cooldownRemainingMs = remaining;
  throw err;
}

// Зарегистрировать punish: экспоненциальный бэкофф с потолком.
export function startQwenPunishCooldown(now = Date.now()) {
  const base = resolvePunishCooldownMs();
  const cap = Math.max(resolvePunishCooldownMaxMs(), base);
  punishStreak += 1;
  const backoffMs = Math.min(base * 2 ** (punishStreak - 1), cap);
  punishUntil = Math.max(punishUntil, now + backoffMs);
  emptyStreak = 0;
  return { punishStreak, backoffMs };
}

/** Успешный ответ: сбросить streak-и и снять кулдаун. */
export function registerQwenCompletionSuccess(now = Date.now()) {
  punishStreak = 0;
  emptyStreak = 0;
  if (punishUntil > now) punishUntil = now;
}

/** Солвер капчи решил punish: немедленно снять кулдаун. */
export function clearQwenPunishCooldown() {
  punishStreak = 0;
  emptyStreak = 0;
  punishUntil = 0;
}

// --- empty-stream backoff ---------------------------------------------------

/**
 * Зафиксировать результат стрима. Пустые стримы подряд наращивают счётчик;
 * при достижении порога включается короткий кулдаун, счётчик сбрасывается.
 */
export function recordQwenStreamOutcome(wasEmpty, now = Date.now()) {
  if (wasEmpty) {
    emptyStreak += 1;
    if (emptyStreak >= emptyStreakThreshold()) {
      const backoff = resolveEmptyBackoffMs();
      punishUntil = Math.max(punishUntil, now + backoff);
      emptyStreak = 0;
    }
    return;
  }
  registerQwenCompletionSuccess(now);
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
 * сериализовались.
 *
 * @param {{now?:()=>number, sleep?:(ms:number)=>Promise<void>}} [inject]
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

  await assertNoQwenAntibotCooldown(nowFn());

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
  return waitMs;
}
