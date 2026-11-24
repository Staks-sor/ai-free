import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { runWithEmptyStreamRetry } from "../api/stream-retry.mjs";

describe("empty provider stream retry", () => {
  it("retries one empty upstream stream before any client delta", async () => {
    let attempts = 0;
    let refreshed = 0;
    const deltas = [];
    const result = await runWithEmptyStreamRetry({
      operation: async ({ onDelta }) => {
        attempts += 1;
        if (attempts === 1) throw emptyStreamError();
        onDelta("ok");
        return { text: "ok" };
      },
      onDelta: (delta) => deltas.push(delta),
      beforeRetry: async () => { refreshed += 1; },
    });

    assert.equal(attempts, 2);
    assert.equal(refreshed, 1);
    assert.deepEqual(deltas, ["ok"]);
    assert.equal(result.text, "ok");
  });

  it("does not retry after a partial delta was sent", async () => {
    let attempts = 0;
    await assert.rejects(() => runWithEmptyStreamRetry({
      operation: async ({ onDelta }) => {
        attempts += 1;
        onDelta("partial");
        throw emptyStreamError();
      },
      onDelta: () => {},
    }), /without response/);
    assert.equal(attempts, 1);
  });

  it("waits exponential backoff between empty-stream retries (1s cap-scaled in tests)", async () => {
    let attempts = 0;
    const beforeRetryCalls = [];
    await assert.rejects(() => runWithEmptyStreamRetry({
      operation: async () => {
        attempts += 1;
        throw emptyStreamError();
      },
      onDelta: () => {},
      maxAttempts: 3,
      backoffBaseMs: 1, // тестовый масштаб: 1ms, 2ms вместо 1s, 2s
      beforeRetry: async ({ attempt }) => { beforeRetryCalls.push(attempt); },
    }), /without response/);
    assert.equal(attempts, 3);
    assert.equal(beforeRetryCalls.length, 2);
  });
});

function emptyStreamError() {
  const error = new Error("ended without response content");
  error.code = "EMPTY_UPSTREAM_STREAM";
  return error;
}
