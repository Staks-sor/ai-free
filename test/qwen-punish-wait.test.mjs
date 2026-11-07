import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  startQwenPunishCooldown,
  startQwenPoolPunishCooldown,
  clearQwenPunishCooldown,
  waitForQwenCompletionSlot,
  resetQwenPacingStateForTests,
} from "../src/providers/qwen/request-pacing.mjs";

// ═══════════════════════════════════════════════════════════════
// Инцидент 06.11 18:00: субагенты + главный поток → IP-level Baxia
// punish → пулевый кулдаун 300с. Hermes ретраил запрос 4 раза, и
// КАЖДЫЙ ретрай мгновенно получал stream_error «Cooldown ~216s» —
// тающий остаток того же кулдауна, отданный как ошибка в лицо.
// Фикс: waitForQwenCompletionSlot при живом кулдауне ≤ QWEN_PUNISH_
// WAIT_MAX_MS (дефолт 300с) ЖДЁТ до конца и продолжает, а не бросает
// ошибку мгновенно. Ошибка — только если остаток больше лимита ожидания.
// ═══════════════════════════════════════════════════════════════

function vitClock(startMs) {
  let now = startMs;
  return {
    now: () => now,
    advance: (ms) => { now += ms; },
    get value() { return now; },
  };
}

describe("punish cooldown: wait instead of instant error", () => {
  it("waits out a short pool cooldown instead of throwing (06.11 incident)", async () => {
    resetQwenPacingStateForTests();
    clearQwenPunishCooldown();
    const clock = vitClock(1_000_000);
    // Пулевый кулдаун 300с
    startQwenPoolPunishCooldown(clock.value);
    const sleeps = [];
    const waited = await waitForQwenCompletionSlot({
      now: () => {
        // время течёт только когда спим — имитация sleep
        return clock.value;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.advance(ms);
      },
      accountId: "acc-1",
      env: {},
    });
    assert.ok(sleeps.length >= 1, `must sleep, slept: ${JSON.stringify(sleeps)}`);
    assert.ok(waited > 0, `must report waited ms, got ${waited}`);
    const totalSlept = sleeps.reduce((a, b) => a + b, 0);
    assert.ok(totalSlept >= 290_000, `must wait ~300s of cooldown, slept ${totalSlept}ms`);
  });

  it("still throws when remaining cooldown exceeds the wait budget", async () => {
    resetQwenPacingStateForTests();
    clearQwenPunishCooldown();
    // Пер-account эскалация: 600с punish (первый страйк)
    startQwenPunishCooldown(1_000_000, "acc-2");
    await assert.rejects(
      () => waitForQwenCompletionSlot({
        now: 1_000_000,
        accountId: "acc-2",
        env: { QWEN_PUNISH_WAIT_MAX_MS: "60000" }, // бюджет 60с < остатка 600с
      }),
      (err) => err.code === "QWEN_ANTIBOT_PUNISH",
      "cooldown longer than budget must still surface as error",
    );
  });

  it("default wait budget covers the 300s pool cooldown", async () => {
    resetQwenPacingStateForTests();
    clearQwenPunishCooldown();
    startQwenPoolPunishCooldown(1_000_000);
    const sleeps = [];
    let t = 1_000_000;
    await waitForQwenCompletionSlot({
      now: () => t,
      sleep: async (ms) => { sleeps.push(ms); t += ms; },
      accountId: "acc-3",
      env: {},
    });
    // Не бросило — значит дождались. Проверяем что ждали именно кулдаун,
    // а не min-interval: суммарно ≥ пула.
    const totalSlept = sleeps.reduce((a, b) => a + b, 0);
    assert.ok(totalSlept >= 290_000, `default budget must absorb 300s pool cooldown, slept ${totalSlept}ms`);
  });
});
