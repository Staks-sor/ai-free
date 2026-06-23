import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLiveMjpegHub } from "../src/window-app/live-mjpeg-hub.mjs";

describe("live-mjpeg-hub", () => {
  it("broadcasts captured frames to subscribers", async () => {
    let calls = 0;
    const hub = createLiveMjpegHub({
      boundary: "test-frame",
      minIntervalMs: 10,
      forceIntervalMs: 50,
      captureFrame: async () => {
        calls += 1;
        return Buffer.from(`frame-${calls}`);
      },
    });

    const chunks = [];
    const closeHandlers = [];
    const res = {
      writeHead() {},
      write(part) { chunks.push(String(part)); return true; },
      on() {},
    };
    const req = {
      on(event, fn) {
        if (event === "close" || event === "aborted") closeHandlers.push(fn);
      },
    };

    hub.attach(req, res);
    await new Promise((r) => setTimeout(r, 80));
    for (const fn of closeHandlers) fn();
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(calls >= 1);
    assert.match(chunks.join(""), /frame-1/);
    hub.reset();
  });
});
