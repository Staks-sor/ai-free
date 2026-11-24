// Only retry a saved model continuation when transport confirms it was not
// accepted. Auth/challenges require recovery by their provider adapter first.
export function automaticResumeDelay(task, error, attempt, delays) {
  if (!task.checkpoint || !['ready', 'awaiting_model'].includes(task.checkpoint.phase)) return null;
  if (!['rate_limited', 'transport_error'].includes(task.failure?.kind)
    || !['rejected', 'not_sent'].includes(task.failure?.delivery) || attempt >= delays.length) return null;
  const fallback = delays[attempt];
  const requested = Number(error.retryAfterMs ?? error.cooldownRemainingMs ?? error.cooldownMs);
  const delay = Math.max(1000, fallback, Number.isFinite(requested) ? requested : 0);
  return delay > 1_800_000 ? null : delay;
}
