import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  buildDragPath,
  hasX5SecCookie,
  resolveBaxiaSolverConfig,
} from "../src/providers/qwen/baxia-solver.mjs";
import {
  startQwenPunishCooldown,
  clearQwenPunishCooldown,
  qwenAntibotCooldownRemainingMs,
  assertNoQwenAntibotCooldown,
  resetQwenPacingStateForTests,
} from "../src/providers/qwen/request-pacing.mjs";

// Детерминированный rng для тестов.
const seededRng = (seed) => () => {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
};

describe("baxia-solver", () => {
  it("buildDragPath: старт/финиш точные, точек steps+1, dtMs в диапазоне", () => {
    const path = buildDragPath({ start: 0, end: 260, steps: 20, jitter: 2, rng: seededRng(42) });
    assert.equal(path.length, 21);
    assert.equal(path[0].x, 0);
    assert.equal(path[path.length - 1].x, 260);
    assert.equal(path[path.length - 1].y, 0);
    // Первая точка — старт (dtMs=0, задержка до mousedown отдельно).
    for (let i = 1; i < path.length; i += 1) {
      const p = path[i];
      assert.ok(p.dtMs >= 8 && p.dtMs < 32, `dtMs out of range: ${p.dtMs}`);
    }
    // Монотонный прогресс (без учёта overshoot).
    for (let i = 1; i < path.length - 1; i += 1) {
      assert.ok(path[i].x >= path[i - 1].x - 0.5, `x regressed at ${i}`);
    }
  });

  it("buildDragPath: overshoot заходит за end и возвращается", () => {
    const path = buildDragPath({ start: 0, end: 200, steps: 24, jitter: 0, rng: seededRng(7), overshootPx: 8 });
    const maxX = Math.max(...path.map((p) => p.x));
    assert.ok(maxX > 200, `overshoot expected, max=${maxX}`);
    assert.equal(path[path.length - 1].x, 200);
  });

  it("buildDragPath: детерминирован при одинаковом rng", () => {
    const a = buildDragPath({ start: 0, end: 100, steps: 10, jitter: 3, rng: seededRng(5) });
    const b = buildDragPath({ start: 0, end: 100, steps: 10, jitter: 3, rng: seededRng(5) });
    assert.deepEqual(a, b);
  });

  it("hasX5SecCookie: true только для непустого x5sec", () => {
    assert.equal(hasX5SecCookie([{ name: "tfstk", value: "x" }]), false);
    assert.equal(hasX5SecCookie([{ name: "x5sec", value: "" }]), false);
    assert.equal(hasX5SecCookie([]), false);
    assert.equal(
      hasX5SecCookie([{ name: "acw_tc", value: "1" }, { name: "x5sec", value: "7b22733b32..." }]),
      true,
    );
  });

  it("конфиг: дефолты, выключение через env, границы", () => {
    const cfg = resolveBaxiaSolverConfig({});
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.maxTries, 3);
    assert.ok(cfg.totalTimeoutMs >= 5_000);

    const off = resolveBaxiaSolverConfig({ QWEN_BAXIA_AUTO_SOLVE: "0" });
    assert.equal(off.enabled, false);

    const clamped = resolveBaxiaSolverConfig({ QWEN_BAXIA_SOLVE_MAX_TRIES: "99" });
    assert.equal(clamped.maxTries, 6);
  });

  it("clearQwenPunishCooldown сбрасывает кулдаун после успешного солва", () => {
    resetQwenPacingStateForTests();
    startQwenPunishCooldown(0);
    assert.ok(qwenAntibotCooldownRemainingMs(1_000) > 0);
    clearQwenPunishCooldown();
    assert.equal(qwenAntibotCooldownRemainingMs(1_000), 0);
    // Не бросает — кулдауна нет.
    assert.equal(assertNoQwenAntibotCooldown(200_000_000), false);
  });
});
