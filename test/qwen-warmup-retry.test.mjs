import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { qwenWarmupRetryPlan } from "../src/providers/qwen/browser-proxy.mjs";

describe("warm-up retry: ERR_TIMED_OUT не должен убивать старт молча", () => {
  it("первый сетевой сбой → retry с задержкой, не смерть", () => {
    const plan = qwenWarmupRetryPlan({ attempt: 0, error: { message: "page.goto: net::ERR_TIMED_OUT" } });
    assert.deepEqual(plan, { action: "retry", delayMs: 5000 });
  });

  it("ERR_NAME_NOT_RESOLVED → retry", () => {
    const plan = qwenWarmupRetryPlan({ attempt: 1, error: { message: "net::ERR_NAME_NOT_RESOLVED" } });
    assert.deepEqual(plan, { action: "retry", delayMs: 15000 });
  });

  it("третий ретрай ещё разрешён (30с), четвёртый сбой → сдача", () => {
    const third = qwenWarmupRetryPlan({ attempt: 2, error: { message: "page.goto: net::ERR_TIMED_OUT" } });
    assert.deepEqual(third, { action: "retry", delayMs: 30_000 });
    const fourth = qwenWarmupRetryPlan({ attempt: 3, error: { message: "page.goto: net::ERR_TIMED_OUT" } });
    assert.deepEqual(fourth, { action: "giveup", delayMs: 0 });
  });

  it("не-сетевая ошибка → сразу giveup", () => {
    const plan = qwenWarmupRetryPlan({ attempt: 0, error: { message: "browserType: Executable doesn't exist" } });
    assert.deepEqual(plan, { action: "giveup", delayMs: 0 });
  });
});
