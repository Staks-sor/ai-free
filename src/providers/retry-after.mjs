export function parseRetryAfterMs(value, now = Date.now()) {
  const text = String(value ?? '').trim();
  if (!text || /^-/.test(text)) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const ms = Number(text) * 1000;
    return Number.isFinite(ms) && Number.isSafeInteger(Math.ceil(now + ms)) ? ms : null;
  }
  const deadline = Date.parse(text);
  return Number.isFinite(deadline) ? Math.max(0, deadline - now) : null;
}

