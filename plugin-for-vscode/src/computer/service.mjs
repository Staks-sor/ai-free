import { fork } from "node:child_process";
import { PNG } from "pngjs";

const MAX_COORDINATE = 100_000;
const MAX_SCROLL = 1_000_000;
const MAX_TEXT = 100_000;
const WORKER_TIMEOUT_MS = 10_000;
const BUTTONS = new Set(["left", "right", "middle"]);
const KEY_ALIASES = new Map([
  ["CTRL", "control"], ["CONTROL", "control"], ["CMD", "command"], ["COMMAND", "command"],
  ["ALT", "alt"], ["OPTION", "alt"], ["SHIFT", "shift"], ["ESC", "escape"],
  ["RETURN", "enter"], ["SPACE", "space"], ["DEL", "delete"], ["BACKSPACE", "backspace"],
]);
const MODIFIERS = new Set(["control", "command", "alt", "shift"]);

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  const error = new Error("Computer action aborted.");
  error.name = "AbortError";
  throw error;
}

function abortError() {
  const error = new Error("Computer action aborted.");
  error.name = "AbortError";
  return error;
}

function integer(value, name, { min = -MAX_COORDINATE, max = MAX_COORDINATE } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function parseKey(raw) {
  const parts = String(raw || "").trim().split("+").map(part => part.trim()).filter(Boolean);
  if (!parts.length) throw new Error("key is required (for example CTRL+S or ENTER).");
  const normalized = parts.map(part => KEY_ALIASES.get(part.toUpperCase()) || part.toLowerCase());
  const key = normalized.at(-1);
  const modifiers = normalized.slice(0, -1);
  if (!/^[a-z0-9_-]{1,32}$/i.test(key) || MODIFIERS.has(key) || new Set(modifiers).size !== modifiers.length || modifiers.some(value => !MODIFIERS.has(value))) {
    throw new Error("key must use one key with optional CTRL, CMD, ALT, or SHIFT modifiers.");
  }
  return { key, modifiers };
}

function validateCall(call = {}) {
  const tool = String(call.tool || call.name || "").trim();
  switch (tool) {
    case "computer_snapshot": return { tool };
    case "computer_click": return {
      tool, x: integer(call.x, "x", { min: 0 }), y: integer(call.y, "y", { min: 0 }),
      button: BUTTONS.has(String(call.button || "left").toLowerCase()) ? String(call.button || "left").toLowerCase() : (() => { throw new Error("button must be left, right, or middle."); })(),
      clicks: integer(call.clicks ?? 1, "clicks", { min: 1, max: 2 }),
    };
    case "computer_move": return { tool, x: integer(call.x, "x", { min: 0 }), y: integer(call.y, "y", { min: 0 }) };
    case "computer_drag": return {
      tool, fromX: integer(call.fromX, "fromX", { min: 0 }), fromY: integer(call.fromY, "fromY", { min: 0 }),
      x: integer(call.x, "x", { min: 0 }), y: integer(call.y, "y", { min: 0 }),
    };
    case "computer_type": {
      const text = String(call.text ?? "");
      if (!text || text.length > MAX_TEXT) throw new Error(`text must contain 1-${MAX_TEXT} characters.`);
      return { tool, text };
    }
    case "computer_key": return { tool, key: parseKey(call.key) };
    case "computer_scroll": return {
      tool, deltaX: integer(call.deltaX ?? 0, "deltaX", { min: -MAX_SCROLL, max: MAX_SCROLL }),
      deltaY: integer(call.deltaY ?? 0, "deltaY", { min: -MAX_SCROLL, max: MAX_SCROLL }),
    };
    default: throw new Error(`Unknown computer tool: ${tool || "(empty)"}`);
  }
}

function assertSupportedDisplay(platform, env) {
  if (!["darwin", "win32", "linux"].includes(platform)) throw new Error(`Native computer control is unsupported on ${platform}.`);
  if (platform === "linux" && (String(env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland" || !env.DISPLAY)) {
    throw new Error("Linux native computer control requires an interactive X11 session with DISPLAY; pure Wayland is unsupported.");
  }
}

export function createNativeWorkerFactory({ timeoutMs = WORKER_TIMEOUT_MS } = {}) {
  return {
    run(payload, signal) {
      return new Promise((resolve, reject) => {
        const child = fork(new URL("./native-worker.mjs", import.meta.url), [], {
          silent: true,
          serialization: "advanced",
          // A forked file cannot inherit `--input-type=module` from a REPL.
          // The worker needs neither inspector nor test-runner parent flags.
          execArgv: [],
        });
        let settled = false;
        let terminateTimer = null;
        let hardKillTimer = null;
        let stderr = "";
        const releaseAndStop = () => {
          child.send?.({ type: "cancel" }, () => {});
          // Give the worker a brief event-loop turn to release any held input
          // before terminating a process that may be inside native code.
          terminateTimer = setTimeout(() => {
            child.kill("SIGTERM");
            hardKillTimer = setTimeout(() => child.kill("SIGKILL"), 500);
            hardKillTimer.unref?.();
          }, 75);
          terminateTimer.unref?.();
        };
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearTimeout(terminateTimer);
          clearTimeout(hardKillTimer);
          signal?.removeEventListener("abort", abort);
          releaseAndStop();
          error ? reject(error) : resolve(value);
        };
        const abort = () => finish(abortError());
        const timer = setTimeout(() => finish(new Error(`Computer action timed out after ${timeoutMs}ms.`)), timeoutMs);
        child.stderr?.setEncoding("utf8");
        child.stderr?.on("data", chunk => { stderr = `${stderr}${chunk}`.slice(-2_000); });
        child.once("error", error => finish(new Error(`Native computer worker failed: ${error.message}`)));
        child.once("exit", (code, reason) => {
          if (!settled) {
            const detail = stderr.trim();
            finish(new Error(`Native computer worker exited before completing (${reason || code}).${detail ? ` stderr: ${detail}` : ""}`));
          }
        });
        child.on("message", message => {
          if (message?.ok) finish(null, message.result);
          else if (message?.error) finish(new Error(message.error));
        });
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) return abort();
        child.send(payload);
      });
    },
  };
}

export async function executeComputerTool(call = {}, options = {}) {
  const signal = options.signal;
  throwIfAborted(signal);
  const payload = validateCall(call);
  assertSupportedDisplay(options.platform || process.platform, options.env || process.env);
  throwIfAborted(signal);
  const worker = (options.workerFactory || createNativeWorkerFactory)({ timeoutMs: options.timeoutMs || WORKER_TIMEOUT_MS });
  const result = await worker.run(payload, signal);
  throwIfAborted(signal);
  if (payload.tool === "computer_snapshot") {
    const screenshot = result?.screenshot || {};
    for (const field of ["width", "height", "logicalWidth", "logicalHeight"]) {
      if (!Number.isInteger(screenshot[field]) || screenshot[field] < 1) throw new Error("Native computer worker returned an invalid screenshot.");
    }
    if (typeof screenshot.base64 !== "string" || !screenshot.base64) throw new Error("Native computer worker returned an empty screenshot.");
    return { ...result, screenshot: { mime: "image/png", base64: screenshot.base64, width: screenshot.width, height: screenshot.height, logicalWidth: screenshot.logicalWidth, logicalHeight: screenshot.logicalHeight } };
  }
  return result;
}

export function pngFromBgra(image, { width, height, byteWidth, bytesPerPixel = 4 }) {
  if (!Buffer.isBuffer(image) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || byteWidth < width * bytesPerPixel || image.length < byteWidth * height) {
    throw new Error("Invalid native screenshot bitmap.");
  }
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = y * byteWidth + x * bytesPerPixel;
      const target = (y * width + x) * 4;
      png.data[target] = image[source + 2];
      png.data[target + 1] = image[source + 1];
      png.data[target + 2] = image[source];
      png.data[target + 3] = bytesPerPixel > 3 ? image[source + 3] : 255;
    }
  }
  return PNG.sync.write(png);
}
