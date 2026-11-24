import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PNG } from "pngjs";
import { createNativeWorkerFactory, executeComputerTool, pngFromBgra } from "../src/computer/service.mjs";
import { executeNativeAction } from "../src/computer/native-worker.mjs";

function fakeWorker(reply) {
  return () => ({ run: async () => reply });
}

describe("computer service", () => {
  it("rejects malformed or unbounded input before a worker starts", async () => {
    await assert.rejects(
      () => executeComputerTool({ tool: "computer_click", x: "no", y: 10 }, { workerFactory: fakeWorker({ ok: true }) }),
      /x must be an integer/i,
    );
    await assert.rejects(
      () => executeComputerTool({ tool: "computer_scroll", deltaY: 1_000_001 }, { workerFactory: fakeWorker({ ok: true }) }),
      /deltaY/i,
    );
    await assert.rejects(
      () => executeComputerTool({ tool: "computer_key", key: "CTRL+" }, { workerFactory: fakeWorker({ ok: true }) }),
      /key/i,
    );
  });

  it("rejects stopped and unsupported display sessions without starting native code", async () => {
    let started = false;
    const workerFactory = () => { started = true; return { run: async () => ({ ok: true }) }; };
    const stopped = AbortSignal.abort();
    await assert.rejects(() => executeComputerTool({ tool: "computer_snapshot" }, { signal: stopped, workerFactory }), error => error.name === "AbortError");
    assert.equal(started, false);
    await assert.rejects(
      () => executeComputerTool({ tool: "computer_snapshot" }, { platform: "linux", env: { XDG_SESSION_TYPE: "wayland" }, workerFactory }),
      /Wayland/i,
    );
    assert.equal(started, false);
    await executeComputerTool({ tool: "computer_move", x: 1, y: 1 }, { platform: "linux", env: { DISPLAY: ":0" }, workerFactory });
    assert.equal(started, true);
  });

  it("normalizes aliases and returns explicit logical and pixel screenshot geometry", async () => {
    let message;
    const display = { platform: "linux", env: { DISPLAY: ":0" } };
    const result = await executeComputerTool(
      { tool: "computer_key", key: "cmd+space" },
      { ...display, workerFactory: () => ({ run: async (value) => { message = value; return { ok: true, key: value.key }; } }) },
    );
    assert.deepEqual(message.key, { key: "space", modifiers: ["command"] });
    assert.deepEqual(result, { ok: true, key: { key: "space", modifiers: ["command"] } });

    const screenshot = await executeComputerTool(
      { tool: "computer_snapshot" },
      { ...display, workerFactory: fakeWorker({ ok: true, screenshot: { base64: "AA==", width: 3840, height: 2160, logicalWidth: 1920, logicalHeight: 1080 } }) },
    );
    assert.deepEqual(screenshot.screenshot, { mime: "image/png", base64: "AA==", width: 3840, height: 2160, logicalWidth: 1920, logicalHeight: 1080 });
  });

  it("encodes strided three- and four-byte BGRA pixels as opaque PNG", async () => {
    const png = pngFromBgra(Buffer.from([
      0, 0, 255, 255, 9, 9, 9, 9,
      0, 255, 0, 255, 8, 8, 8, 8,
    ]), { width: 1, height: 2, byteWidth: 8, bytesPerPixel: 4 });
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
    assert.deepEqual([...PNG.sync.read(png).data], [255, 0, 0, 255, 0, 255, 0, 255]);
    const rgb = pngFromBgra(Buffer.from([0, 0, 255, 7, 7, 7]), { width: 1, height: 1, byteWidth: 3, bytesPerPixel: 3 });
    assert.deepEqual([...PNG.sync.read(rgb).data], [255, 0, 0, 255]);
  });

  it("releases the pointer when a native drag fails", async () => {
    const calls = [];
    const robot = {
      getScreenSize: () => ({ width: 100, height: 100 }),
      moveMouse: (...args) => calls.push(["move", ...args]),
      mouseToggle: (...args) => calls.push(["toggle", ...args]),
      dragMouse: () => { throw new Error("native drag failed"); },
    };
    await assert.rejects(
      () => executeNativeAction({ tool: "computer_drag", fromX: 1, fromY: 2, x: 3, y: 4 }, robot, null, null, "win32"),
      /native drag failed/,
    );
    assert.deepEqual(calls.at(-1), ["toggle", "up", "left"]);
  });

  it("reports a missing native dependency instead of pretending control is available", async () => {
    await assert.rejects(
      () => executeNativeAction({ tool: "computer_snapshot" }, null, async () => { throw new Error("optional package missing"); }, null, "win32"),
      /optional package missing/,
    );
  });

  it("releases only modifiers pressed before a later modifier fails", async () => {
    const calls = [];
    const robot = {
      keyToggle: (key, direction) => {
        calls.push([key, direction]);
        if (key === "alt" && direction === "down") throw new Error("alt unavailable");
      },
      keyTap: () => assert.fail("key tap must not happen"),
    };
    await assert.rejects(
      () => executeNativeAction({ tool: "computer_key", key: { key: "s", modifiers: ["control", "alt"] } }, robot, null, null, "win32"),
      /alt unavailable/,
    );
    assert.deepEqual(calls, [["control", "down"], ["alt", "down"], ["control", "up"]]);
  });

  it("gates macOS input and capture before RobotJS actions, while retaining Retina bitmap geometry", async () => {
    let touched = false;
    const robot = {
      getScreenSize: () => ({ width: 3840, height: 2160 }),
      moveMouse: () => { touched = true; },
      screen: { capture: () => { touched = true; return { image: Buffer.from([0, 0, 0]), width: 3840, height: 2160, byteWidth: 11520, bytesPerPixel: 3 }; } },
    };
    await assert.rejects(
      () => executeNativeAction({ tool: "computer_move", x: 5, y: 5 }, robot, null, async () => ({ accessibility: false, screenRecording: true, logicalWidth: 1920, logicalHeight: 1080 }), "darwin"),
      /Accessibility/i,
    );
    assert.equal(touched, false);
    await assert.rejects(
      () => executeNativeAction({ tool: "computer_snapshot" }, robot, null, async () => ({ accessibility: true, screenRecording: false, logicalWidth: 1920, logicalHeight: 1080 }), "darwin"),
      /Screen Recording/i,
    );
    assert.equal(touched, false);
  });

  it("starts the real native worker without inheriting REPL execution flags", async () => {
    const original = process.execArgv;
    // A debugger on the host must not reopen a debug port or pause a worker.
    process.execArgv = [...original, '--inspect-brk=127.0.0.1:0'];
    try {
      const worker = createNativeWorkerFactory({ timeoutMs: 1_000 });
      assert.deepEqual(await worker.run({ type: "ping" }), { ok: true });
    } finally { process.execArgv = original; }
  });
});
