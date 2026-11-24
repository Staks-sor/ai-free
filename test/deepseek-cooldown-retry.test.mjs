import { it } from "node:test";
import { strict as assert } from "node:assert";

import { runDeepSeekCodeWithCooldown } from "../src/providers/deepseek/cooldown-retry.mjs";

it("waits and resumes a rate-limited code task from its checkpoint", async () => {
  const attempts = [];
  const waits = [];
  const saved = { task: "review", prompt: "next step", parentMessageId: 7, toolLogs: ["read README"] };
  const result = await runDeepSeekCodeWithCooldown({
    run: async (checkpoint) => {
      attempts.push(checkpoint);
      if (attempts.length === 1) throw Object.assign(new Error("limit"), { code: "DEEPSEEK_RATE_LIMIT", delivery: "rejected" });
      return { message: "done" };
    },
    checkpoint: () => saved,
    wait: async (ms) => { waits.push(ms); },
  });
  assert.deepEqual(attempts, [null, saved]);
  assert.deepEqual(waits, [60_000]);
  assert.equal(result.message, "done");
});

it("stops after bounded cooldowns and leaves the checkpoint available", async () => {
  let calls = 0;
  const saved = { task: "review", prompt: "next step", toolLogs: [] };
  await assert.rejects(runDeepSeekCodeWithCooldown({
    run: async () => { calls += 1; throw Object.assign(new Error("limit"), { code: "DEEPSEEK_RATE_LIMIT", delivery: "rejected" }); },
    checkpoint: () => saved,
    wait: async () => {},
  }), (error) => error.code === "DEEPSEEK_RATE_LIMIT");
  assert.equal(calls, 3);
});

it("never repeats a different provider failure", async () => {
  let calls = 0;
  await assert.rejects(runDeepSeekCodeWithCooldown({
    run: async () => { calls += 1; throw new Error("invalid request"); },
    checkpoint: () => ({ prompt: "x" }),
    wait: async () => {},
  }), /invalid request/);
  assert.equal(calls, 1);
});

it('never replays a rate limit when delivery is unknown or partial',async()=>{
  let calls=0;
  await assert.rejects(runDeepSeekCodeWithCooldown({run:async()=>{calls++;throw Object.assign(new Error('partial'),{code:'DEEPSEEK_RATE_LIMIT',delivery:'unknown'});},checkpoint:()=>({prompt:'next'}),wait:async()=>assert.fail('unsafe retry')}),/partial/);
  assert.equal(calls,1);
});

it('honours Retry-After as a deadline without adding the fallback delay',async()=>{
  let calls=0;const waits=[];
  const result=await runDeepSeekCodeWithCooldown({run:async()=>{if(++calls===1)throw Object.assign(new Error('limited'),{code:'DEEPSEEK_RATE_LIMIT',delivery:'rejected',retryAfterMs:90000});return 'ok';},checkpoint:()=>({phase:'awaiting_model',prompt:'next'}),wait:async ms=>waits.push(ms)});
  assert.equal(result,'ok');assert.deepEqual(waits,[90000]);
});

it('keeps very long provider deadlines and interrupted tools paused',async()=>{
  for(const [phase,retryAfterMs] of [['awaiting_model',3600000],['executing_tool',60000]]){
    await assert.rejects(runDeepSeekCodeWithCooldown({run:async()=>{throw Object.assign(new Error('limited'),{code:'DEEPSEEK_RATE_LIMIT',delivery:'rejected',retryAfterMs});},checkpoint:()=>({phase,prompt:'next'}),wait:async()=>assert.fail('early or unsafe retry')}),/limited/);
  }
});
