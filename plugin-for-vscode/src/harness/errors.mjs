// Structured evidence only: model prose or a generic 403 is not proof of a
// blocked/expired account. Adapters can supply delivery evidence when known.
export function classifyProviderFailure(error = {}) {
  const code = String(error.code || '');
  const status = Number(error.status || error.httpStatus);
  let kind = 'provider_error';
  if (error.name === 'AbortError') kind = 'cancelled';
  else if (error.isChallenge || /ANTIBOT|CAPTCHA/.test(code)) kind = 'challenge_required';
  else if (status === 429 || /RATE_LIMIT|QUOTA|COOLDOWN/.test(code)) kind = 'rate_limited';
  else if (status === 401 || error.isAuthError || /AUTH_REQUIRED|LOGIN_REQUIRED|SESSION_EXPIRED/.test(code)) kind = 'auth_required';
  else if (/TIMEOUT|ETIMEDOUT|ECONNRESET|NETWORK|TRANSPORT|EMPTY_UPSTREAM/.test(code)) kind = 'transport_error';
  const delivery = ['not_sent', 'rejected', 'accepted', 'unknown'].includes(error.delivery)
    ? error.delivery : [401, 429].includes(status) ? 'rejected' : 'unknown';
  return { kind, delivery, code: code || 'PROVIDER_ERROR', status: Number.isFinite(status) && status > 0 ? status : null };
}

export function formatHarnessFailureMessage(conversation, error) {
  const task = conversation?.harnessTask;
  const failure = task?.failure || classifyProviderFailure(error);
  if (error.code === 'HARNESS_REVIEW_REQUIRED' && conversation?.provider === 'qwen'
    && task?.checkpoint?.phase === 'awaiting_model' && failure.delivery === 'unknown') {
    return '⚠️ Задача сохранена. Ответ Qwen ещё не удалось однозначно восстановить из истории после автоматических проверок. Задача остаётся на паузе; повторный запрос не отправлен.';
  }
  if (failure.kind !== 'transport_error' || !task?.checkpoint) return `⚠️ /code error: ${error.message}`;
  const count = task.checkpoint.toolLogs?.length || 0;
  return [
    '⚠️ Связь с AI прервалась. Задача и результаты инструментов сохранены (' + count + ').',
    failure.delivery === 'unknown'
      ? 'Неизвестно, завершил ли AI последний запрос. Автоматический повтор остановлен, чтобы не выполнять действия дважды. Проверьте последний ответ в чате провайдера перед продолжением.'
      : 'Продолжить сохранённую задачу можно в панели «Агенты и задачи».',
    'Причина: ' + error.message,
  ].join('\n\n');
}
