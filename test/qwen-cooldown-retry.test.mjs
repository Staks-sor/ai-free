import assert from "node:assert/strict";
import { test } from "node:test";
import { runQwenCodeWithCooldown } from "../src/providers/qwen/cooldown-retry.mjs";

test("Qwen /code waits once, then resumes from the saved checkpoint", async () => {
  const calls = [];
  const waits = [];
  const result = await runQwenCodeWithCooldown({
    run: async (checkpoint) => {
      calls.push(checkpoint);
      if (calls.length === 1) throw Object.assign(new Error("punish"), { code: "QWEN_ANTIBOT_PUNISH", cooldownMs: 600_000 });
      return "done";
    },
    checkpoint: () => ({ prompt: "tool already completed", toolLogs: ["wrote file"] }),
    wait: async (ms) => { waits.push(ms); },
  });
  assert.equal(result, "done");
  assert.deepEqual(calls, [null, { prompt: "tool already completed", toolLogs: ["wrote file"] }]);
  assert.deepEqual(waits, [601_000]);
});

test("Qwen /code never retries a second punish or a non-punish error", async () => {
  for (const code of ["QWEN_ANTIBOT_PUNISH", "NETWORK_ERROR"]) {
    let calls = 0;
    await assert.rejects(() => runQwenCodeWithCooldown({
      run: async () => { calls++; throw Object.assign(new Error("failure"), { code, cooldownMs: 1 }); },
      checkpoint: () => ({ prompt: "saved" }),
      wait: async () => {},
    }), /failure/);
    assert.equal(calls, code === "QWEN_ANTIBOT_PUNISH" ? 2 : 1);
  }
});
