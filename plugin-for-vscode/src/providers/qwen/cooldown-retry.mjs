import { setTimeout as sleep } from "node:timers/promises";

export async function runQwenCodeWithCooldown({ run, checkpoint, onWait = () => {},
  wait = (ms, signal) => sleep(ms, undefined, { signal }), signal }) {
  try {
    return await run(null);
  } catch (error) {
    if (error?.code !== "QWEN_ANTIBOT_PUNISH") throw error;
    const saved = checkpoint();
    if (!saved || typeof saved !== "object") throw error;
    const requested = Number(error.cooldownRemainingMs ?? error.cooldownMs ?? 600_000);
    const waitMs = Math.max(1, Math.min(Number.isFinite(requested) ? requested : 600_000, 1_800_000)) + 1_000;
    onWait(waitMs);
    await wait(waitMs, signal);
    signal?.throwIfAborted();
    return run(saved);
  }
}
