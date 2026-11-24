// Only protocol evidence can request login. A generic 403 does not establish
// expiry; HTML challenges take precedence even when the edge responds 401.
export function throwIfDeepSeekResponseFailure(status, text, context) {
  const head = String(text || '').slice(0, 4096);
  const html = /<!doctype html|<html[\s>]|<body[\s>]/i.test(head);
  if (html && /captcha|turnstile|cf-chl|challenge-platform|verify you are human|security check/i.test(head)) {
    throw Object.assign(new Error(`DeepSeek: требуется проверка доступа (${context}).`),
      { code: 'DEEPSEEK_CHALLENGE_REQUIRED', status, isChallenge: true, delivery: 'unknown' });
  }
  let json;
  if (!html) { try { json = JSON.parse(String(text || '')); } catch {} }
  if (status === 401 || [40002, 40003].includes(json?.code)) {
    throw Object.assign(new Error(`DeepSeek: сессия истекла или требуется вход (${context}).`),
      { code: 'DEEPSEEK_AUTH_REQUIRED', status, isAuthError: true, delivery: 'rejected' });
  }
  if (status === 403) {
    throw Object.assign(new Error(`DeepSeek отказал в доступе (${context}); причина не подтверждена.`),
      { code: 'DEEPSEEK_ACCESS_DENIED', status, delivery: 'unknown' });
  }
  if (html) {
    throw Object.assign(new Error(`DeepSeek вернул HTML вместо API (${context}); причина не подтверждена.`),
      { code: 'DEEPSEEK_UNEXPECTED_RESPONSE', status, delivery: 'unknown' });
  }
}
