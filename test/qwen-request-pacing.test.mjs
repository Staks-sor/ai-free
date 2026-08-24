import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
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

describe("кулдаун после punish", () => {
  beforeEach(() => resetQwenPacingStateForTests());

  it("registerQwenPunish включает кулдаун и растит его экспоненциально с потолком", async () => {
    withEnv({ QWEN_PUNISH_COOLDOWN_MS: "60000", QWEN_PUNISH_COOLDOWN_MAX_MS: "300000" }, async () => {
      const first = registerQwenPunish(1_000);
      assert.equal(first.punishStreak, 1);
      assert.equal(first.backoffMs, 60_000);
      assert.equal(qwenAntibotCooldownRemainingMs(1_000), 60_000);
      assert.equal(qwenAntibotCooldownRemainingMs(30_000), 31_000);

      const second = registerQwenPunish(2_000);
      assert.equal(second.backoffMs, 120_000); // 60s * 2^1
      const third = registerQwenPunish(3_000);
      assert.equal(third.backoffMs, 240_000); // 60s * 2^2
      const fourth = registerQwenPunish(4_000);
      assert.equal(fourth.backoffMs, 300_000); // capped
      const fifth = registerQwenPunish(5_000);
      assert.equal(fifth.backoffMs, 300_000); // всё ещё потолок
    });
  });

  it("успешный ответ сбрасывает streak и кулдаун", async () => {
    registerQwenPunish(1_000);
    registerQwenCompletionSuccess(2_000);
    assert.equal(qwenAntibotCooldownRemainingMs(2_000), 0);
    // следующая punish начинает с базового интервала, а не с удвоенного
    const again = registerQwenPunish(3_000);
    assert.equal(again.punishStreak, 1);
  });

  it("assertNoQwenAntibotCooldown кидает читаемую ошибку с кодом и секундами", async () => {
    withEnv({ QWEN_PUNISH_COOLDOWN_MS: "90000" }, async () => {
      registerQwenPunish(0);
      assert.throws(
        () => assertNoQwenAntibotCooldown(1_000),
        (err) => err.code === QWEN_ANTIBOT_PUNISH && /89s|89 s/i.test(err.message) && err.cooldownRemainingMs === 89_000,
      );
      // после истечения — не кидает
      assert.equal(assertNoQwenAntibotCooldown(600_000), false);
    });
  });

  it("createQwenPunishError формирует сообщение с советом охлаждения", async () => {
    const err = createQwenPunishError(125_000);
    assert.equal(err.code, QWEN_ANTIBOT_PUNISH);
    assert.match(err.message, /Baxia|антибот/i);
    assert.match(err.message, /QWEN_COMPLETION_MIN_INTERVAL_MS/);
  });
});

describe("pacing: минимальный интервал между POST /completions", () => {
  beforeEach(() => resetQwenPacingStateForTests());

  it("первый слот ждёт 0, второй в пределах интервала — ждёт остаток", async () => {
    withEnv({ QWEN_COMPLETION_MIN_INTERVAL_MS: "2000" }, async () => {
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
    withEnv({ QWEN_COMPLETION_MIN_INTERVAL_MS: undefined, QWEN_PUNISH_COOLDOWN_MS: undefined }, async () => {
      const minIntervalMs = defaultMinIntervalMs();
      const punishCooldownMs = defaultPunishCooldownMs();
      assert.ok(minIntervalMs >= 1_000 && minIntervalMs <= 5_000);
      assert.ok(punishCooldownMs >= 30_000);
    });
  });
});
