import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createWorkerStreamRouter } from "../src/providers/qwen/browser-proxy.mjs";

describe("Qwen worker stream router", () => {
  it("keeps concurrent worker chunks isolated", async () => {
    const router = createWorkerStreamRouter();
    const a = [];
    const b = [];
    router.bind("page0", (chunk) => { a.push(chunk); return true; });
    router.bind("page1", (chunk) => { b.push(chunk); return true; });

    assert.equal(router.push("page0", "A1"), true);
    assert.equal(router.push("page1", "B1"), true);
    assert.equal(router.push("page0", "A2"), true);
    assert.deepEqual(a, ["A1", "A2"]);
    assert.deepEqual(b, ["B1"]);

    router.unbind("page0");
    assert.equal(router.push("page0", "ignored"), false);
  });
});
