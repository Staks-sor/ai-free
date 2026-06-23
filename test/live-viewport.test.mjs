import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampLiveViewport, createLiveViewportState } from "../src/window-app/live-viewport.mjs";

describe("live-viewport", () => {
  it("clamps dimensions", () => {
    const out = clampLiveViewport(50, 5000, { width: 580, height: 900 });
    assert.equal(out.width, 280);
    assert.equal(out.height, 1800);
  });

  it("updates shared viewport state", () => {
    const state = createLiveViewportState({ width: 580, height: 900 });
    const next = state.set(720, 840);
    assert.equal(next.width, 720);
    assert.equal(state.get().height, 840);
  });
});
