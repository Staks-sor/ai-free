export function resolveQwenStreamTimeouts(env = process.env) {
  return {
    firstContentMs: Number(env.QWEN_STREAM_FIRST_CONTENT_TIMEOUT_MS || 60_000),
    idleMs: Number(env.QWEN_STREAM_IDLE_TIMEOUT_MS || 90_000),
  };
}
