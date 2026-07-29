export async function runWithEmptyStreamRetry({
  operation,
  onDelta,
  beforeRetry = null,
  maxAttempts = 2,
}) {
  let emitted = false;
  const emit = (delta) => {
    if (delta) emitted = true;
    onDelta?.(delta);
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await operation({ attempt, onDelta: emit });
      if (!emitted && !String(result?.text || "")) {
        throw createEmptyStreamError();
      }
      return result;
    } catch (error) {
      if (emitted || error?.code !== "EMPTY_UPSTREAM_STREAM" || attempt >= maxAttempts) throw error;
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
