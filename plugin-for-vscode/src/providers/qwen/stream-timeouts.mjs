export function resolveQwenStreamTimeouts(env = process.env) {
  return {
    fetchMs: Number(env.QWEN_FETCH_TIMEOUT_MS || 600_000),
    firstContentMs: Number(env.QWEN_STREAM_FIRST_CONTENT_TIMEOUT_MS || 240_000),
    idleMs: Number(env.QWEN_STREAM_IDLE_TIMEOUT_MS || 90_000),
  };
}
