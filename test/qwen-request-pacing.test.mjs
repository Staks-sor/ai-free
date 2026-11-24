import assert from "node:assert/strict";
import { describe, it, beforeEach, test } from "node:test";
import {
  QWEN_ANTIBOT_PUNISH,
  assertNoQwenAntibotCooldown,
  createQwenPunishError,
  isQwenPunishResponse,
  getQwenAntibotCooldownRemaining,
  qwenAntibotCooldownRemainingMs,
  recordQwenStreamOutcome,
  startQwenPunishCooldown,
  registerQwenPunish,
  registerQwenCompletionSuccess,
  resetQwenPacingStateForTests,
  waitForQwenCompletionSlot,
} from "../src/providers/qwen/request-pacing.mjs";

// Тестовые хелперы для дефолтов (экспортируются только для тестов).
const {
  defaultMinIntervalMs,
  defaultPunishCooldownMs,
} = await import("../src/providers/qwen/request-pacing.mjs");

// Реальная punish-страница Baxia (Alibaba TMD), наблюдавшаяся 2026-08-20:
// POST /api/v2/chat/completions → 200 text/html с редиректом на капчу-слайдер.
const PUNISH_HTML =
  "<!DOCTYPE html><html><head><script src=\"https://g.alicdn.com/bsop-static/sufei-punish/0.1.125/build/punishpage.min.js\"></script>" +
  "<meta http-equiv=\"refresh\" content=\"0;url=https://chat.qwen.ai//api/v2/chat/completions/_____tmd_____/punish?x5secdata=xg63...&amp;x5step=2&amp;action=captcha\"></head>" +
  "<body><div id=\"nc_1_wrapper\" class=\"nc_wrapper\">Проведите ползунок вправо</div></body></html>";

const PUNISH_JSON = JSON.stringify({
  ret: ["RGV587_ERROR:: Heavy traffic / risk control"],
  success: false,
  data: { url: "https://chat.qwen.ai/api/v2/chat/completions/_____tmd_____/punish?x5secdata=..." },
});

function withEnv(patch, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(patch)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  let result;
  try {
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }
  // async-колбэк: восстанавливаем env только после его завершения
  if (result && typeof result.finally === "function") {
    return result.finally(restore);
  }
  restore();
  return result;
}

describe("isQwenPunishResponse", () => {
  it("распознаёт HTML punish-страницу (text/html + _____tmd_____/punish)", async () => {
    assert.equal(isQwenPunishResponse({ contentType: "text/html", text: PUNISH_HTML }), true);
  });

  it("распознаёт JSON-заглушку RGV587 с data.url punish", async () => {
    assert.equal(isQwenPunishResponse({ contentType: "application/json", text: PUNISH_JSON }), true);
  });

  it("не считает punish обычный SSE-стрим или HTML без маркеров TMD", async () => {
    assert.equal(isQwenPunishResponse({ contentType: "text/event-stream", text: "data: {\"choices\":[]}" }), false);
    assert.equal(isQwenPunishResponse({ contentType: "text/html", text: "<html><body>login</body></html>" }), false);
    assert.equal(isQwenPunishResponse({ contentType: "application/json", text: "{\"ret\":[],\"success\":true}" }), false);
    assert.equal(isQwenPunishResponse(null), false);
  });
});

test("punish errors report the observed challenge without claiming a provider deadline", () => {
  const err = createQwenPunishError(0);
  assert.equal(err.code, QWEN_ANTIBOT_PUNISH);
  assert.match(err.message, /проверку/i);
  assert.equal(err.cooldownMs, 0);
});

describe("pacing: минимальный интервал между POST /completions", () => {
  beforeEach(() => resetQwenPacingStateForTests());

  it("первый слот ждёт 0, второй в пределах интервала — ждёт остаток", async () => {
    await withEnv({ QWEN_COMPLETION_MIN_INTERVAL_MS: "2000" }, async () => {
      const sleeps = [];
      const sleep = async (ms) => { sleeps.push(ms); };
      const first = await waitForQwenCompletionSlot({ now: 10_000, sleep });
      assert.equal(first, 0);

      const second = await waitForQwenCompletionSlot({ now: 11_000, sleep });
      assert.equal(second, 1_000); // 10_000 + 2_000 - 11_000
      assert.deepEqual(sleeps, [1_000]);

      // после паузы слот снова свободен
      const third = await waitForQwenCompletionSlot({ now: 15_000, sleep });
      assert.equal(third, 0);
    });
  });

  it("резервирует слот на момент releasing, чтобы параллельные запросы сериализовались", async () => {
    await withEnv({ QWEN_COMPLETION_MIN_INTERVAL_MS: "3000" }, async () => {
      const sleep = async () => {};
      const a = waitForQwenCompletionSlot({ now: 0, sleep });
      const b = waitForQwenCompletionSlot({ now: 1_000, sleep });
      // слот A занял [0..0+3000), B стартовал в 1_000 → ждёт до 3_000
      await a;
      const waited = await b;
      assert.equal(waited, 2_000);
    });
  });

  it("конфиг читается из env с безопасными дефолтами", async () => {
    await withEnv({ QWEN_COMPLETION_MIN_INTERVAL_MS: undefined, QWEN_PUNISH_COOLDOWN_MS: undefined }, async () => {
      const minIntervalMs = defaultMinIntervalMs();
      const punishCooldownMs = defaultPunishCooldownMs();
      assert.equal(minIntervalMs, 0);
      assert.equal(punishCooldownMs, 0);
    });
  });
});

test('aborted waits never release a request slot', async () => {
  resetQwenPacingStateForTests();
  await withEnv({QWEN_COMPLETION_MIN_INTERVAL_MS:'1000'}, async () => {
    const controller=new AbortController();controller.abort();
    await assert.rejects(waitForQwenCompletionSlot({signal:controller.signal}),e=>e.name==='AbortError');
    const pending=new AbortController();await waitForQwenCompletionSlot({now:0,sleep:async()=>{}});
    await assert.rejects(waitForQwenCompletionSlot({now:1,signal:pending.signal,sleep:async()=>pending.abort()}),e=>e.name==='AbortError');
  });
});

describe('provider Retry-After deadline', () => {
  beforeEach(() => resetQwenPacingStateForTests());
  it('combines Retry-After with spacing as deadlines rather than adding delays', async () => {
    const {registerQwenRetryAfter}=await import('../src/providers/qwen/request-pacing.mjs');
    await withEnv({QWEN_COMPLETION_MIN_INTERVAL_MS:'1000'},async()=>{
      await waitForQwenCompletionSlot({accountId:'rate',now:0,sleep:async()=>{}});
      registerQwenRetryAfter('2',0,'rate');
      await assert.rejects(waitForQwenCompletionSlot({accountId:'rate',now:1000}),e=>e.code==='QWEN_RATE_LIMIT'&&e.retryAfterMs===1000&&e.delivery==='not_sent');
      assert.equal(await waitForQwenCompletionSlot({accountId:'rate',now:2000,sleep:async()=>assert.fail('double delay')}),0);
    });
  });
  it('keeps a newer deadline despite late success or CAPTCHA clear and parses HTTP dates',async()=>{
    const {registerQwenRetryAfter,parseRetryAfterMs,clearQwenPunishCooldown}=await import('../src/providers/qwen/request-pacing.mjs');
    assert.equal(parseRetryAfterMs('Thu, 01 Jan 1970 00:00:05 GMT',1000),4000);
    assert.equal(parseRetryAfterMs('garbage',1000),null);
    assert.equal(parseRetryAfterMs('-1',1000),null);
    registerQwenRetryAfter('10',1000,'rate');registerQwenRetryAfter('1',2000,'rate');
    registerQwenCompletionSuccess(3000,'rate',500);clearQwenPunishCooldown('rate');
    await assert.rejects(waitForQwenCompletionSlot({accountId:'rate',now:3000}),e=>e.retryAfterMs===8000);
  });
});

describe('late reservation release',()=>{
  beforeEach(()=>resetQwenPacingStateForTests());
  it('rechecks actual dispatch spacing when an earlier queued reservation resumes late',async()=>{
    await withEnv({QWEN_COMPLETION_MIN_INTERVAL_MS:'1000'},async()=>{
      let clock=0,wake,entered;const ready=new Promise(r=>{entered=r;});
      await waitForQwenCompletionSlot({now:()=>clock,sleep:async()=>{}});
      const sleeps=[];
      const late=waitForQwenCompletionSlot({now:()=>clock,sleep:async ms=>{sleeps.push(ms);if(!wake){await new Promise(r=>{wake=r;entered();});}else clock+=ms;}});
      await ready;clock=5000;
      await waitForQwenCompletionSlot({now:()=>clock,sleep:async()=>assert.fail('long turn consumed interval')});
      wake();assert.equal(await late,2000);assert.deepEqual(sleeps,[1000,1000]);
    });
  });
});

test('explicit zero spacing disables a previously reserved interval without clearing cooldown',async()=>{
  resetQwenPacingStateForTests();
  await withEnv({QWEN_COMPLETION_MIN_INTERVAL_MS:'1000'},()=>waitForQwenCompletionSlot({now:1000,sleep:async()=>{}}));
  await withEnv({QWEN_COMPLETION_MIN_INTERVAL_MS:'0'},async()=>{
    assert.equal(await waitForQwenCompletionSlot({now:1001,sleep:async()=>assert.fail('spacing disabled')}),0);
    const {registerQwenRetryAfter}=await import('../src/providers/qwen/request-pacing.mjs');
    registerQwenRetryAfter('2',1001);
    await assert.rejects(waitForQwenCompletionSlot({now:1001}),e=>e.code==='QWEN_RATE_LIMIT');
  });
});

test('browser admission waits after page preparation without adding a second reservation',async()=>{
  resetQwenPacingStateForTests();
  const {waitForQwenDispatchSlot}=await import('../src/providers/qwen/request-pacing.mjs');
  await withEnv({QWEN_COMPLETION_MIN_INTERVAL_MS:'1000'},async()=>{
    const sleep=async()=>{};
    assert.equal(await waitForQwenCompletionSlot({now:0,sleep,deferDispatch:true}),0);
    assert.equal(await waitForQwenDispatchSlot({now:0,sleep}),0);
    assert.equal(await waitForQwenCompletionSlot({now:1000,sleep,deferDispatch:true}),0);
    // A different prepared request started while this one was navigating.
    assert.equal(await waitForQwenDispatchSlot({now:5000,sleep}),0);
    assert.equal(await waitForQwenDispatchSlot({now:5000,sleep}),1000);
    const {registerQwenRetryAfter}=await import('../src/providers/qwen/request-pacing.mjs');
    registerQwenRetryAfter('2',7000);
    await assert.rejects(waitForQwenDispatchSlot({now:7000,sleep}),e=>e.code==='QWEN_RATE_LIMIT'&&e.delivery==='not_sent');
  });
});
