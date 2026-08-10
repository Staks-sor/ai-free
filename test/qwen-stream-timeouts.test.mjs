import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveQwenStreamTimeouts } from "../src/providers/qwen/stream-timeouts.mjs";

describe("Qwen stream timeouts", () => {
  it("allows slow models enough time to emit their first response delta", () => {
    const timeouts = resolveQwenStreamTimeouts({});

    assert.equal(timeouts.firstContentMs, 60_000);
    assert.equal(timeouts.idleMs, 90_000);
  });

  it("keeps explicit environment overrides", () => {
    const timeouts = resolveQwenStreamTimeouts({
      QWEN_STREAM_FIRST_CONTENT_TIMEOUT_MS: "75000",
      QWEN_STREAM_IDLE_TIMEOUT_MS: "100000",
    });

    assert.equal(timeouts.firstContentMs, 75_000);
    assert.equal(timeouts.idleMs, 100_000);
  });
});
