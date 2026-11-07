export async function runWithEmptyStreamRetry({
  operation,
  onDelta,
  beforeRetry = null,
  maxAttempts = 2,
  requireDelta = false,
  // Экспоненциальный backoff между ретраями пустого стрима: base, 2*base…
  // capped. По умолчанию base=1000ms, cap=30s. Тесты инжектят base=1.
  backoffBaseMs = 1000,
  backoffCapMs = 30_000,
}) {
  let emitted = false;
  const emit = (delta) => {
    if (delta) emitted = true;
    onDelta?.(delta);
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await operation({ attempt, onDelta: emit });
      if (!emitted && (requireDelta || !String(result?.text || ""))) {
        throw createEmptyStreamError();
      }
      return result;
    } catch (error) {
      if (emitted || error?.code !== "EMPTY_UPSTREAM_STREAM" || attempt >= maxAttempts) throw error;
      // Пауза перед повторной попыткой: на деградированных днях Qwen может
      // «остыть» за пару секунд; мгновенный повтор только разгоняет
      // риск-скоринг Baxia.
      const delayMs = Math.min(backoffBaseMs * 2 ** (attempt - 1), backoffCapMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      await beforeRetry?.({ attempt, error });
    }
  }
  throw createEmptyStreamError();
}

export function createEmptyStreamError(message = "Upstream model stream ended without response content.") {
  const error = new Error(message);
  error.code = "EMPTY_UPSTREAM_STREAM";
  return error;
}
