export function isQwenCaptchaError(error) {
  return error?.code === "QWEN_ANTIBOT_PUNISH"
    || /Qwen Baxia antibot punish \(captcha\)/i.test(String(error?.message || ""));
}

export function isQwenCaptchaRetryableTurn(conversation, retry) {
  const messages = conversation?.messages;
  return conversation?.provider === "qwen"
    && Array.isArray(messages)
    && Number.isInteger(retry?.userIndex)
    && Number.isInteger(retry?.assistantIndex)
    && retry.assistantIndex === messages.length - 1
    && retry.userIndex < retry.assistantIndex
    && messages[retry.userIndex]?.role === "user"
    && Boolean(messages[retry.userIndex]?.content)
    && messages[retry.assistantIndex]?.role === "assistant"
    && messages[retry.assistantIndex]?.qwenCaptchaRetryable === true;
}

// A saved browser verification is not a live challenge after process restart.
export function recoverQwenCaptchaState(state) {
  let changed = false;
  for (const conversation of state.conversations || []) {
    const pending = conversation.provider === 'qwen' && conversation.pendingQwenCaptcha;
    if (!pending || pending.status === 'stale') continue;
    pending.status = 'stale';
    pending.challengeVisible = false;
    delete pending.error;
    changed = true;
  }
  return changed;
}
