import { setTimeout as sleep } from "node:timers/promises";
import { automaticResumeDelay } from "../../harness/auto-continue.mjs";
import { classifyProviderFailure } from "../../harness/errors.mjs";

const COOLDOWNS_MS = [60_000, 120_000];

export async function runDeepSeekCodeWithCooldown({
  run,
  checkpoint,
  onWait = () => {},
  wait = (ms, signal) => sleep(ms, undefined, { signal }),
  signal,
}) {
  let saved = null;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run(saved);
    } catch (error) {
      if (error?.code !== "DEEPSEEK_RATE_LIMIT" || attempt >= COOLDOWNS_MS.length) throw error;
      saved = checkpoint();
      if (!saved || typeof saved !== "object") throw error;
      const waitMs = automaticResumeDelay({ checkpoint: { ...saved, phase: saved.phase || "ready" },
        failure: classifyProviderFailure(error) }, error, attempt, COOLDOWNS_MS);
      if (waitMs === null) throw error;
      onWait(waitMs);
      await wait(waitMs, signal);
      signal?.throwIfAborted();
    }
  }
}
