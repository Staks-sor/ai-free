import { pngFromBgra } from "./service.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAC_PERMISSION_SCRIPT = `ObjC.import('Cocoa');
ObjC.import('ApplicationServices');
ObjC.import('CoreGraphics');
ObjC.bindFunction('CGPreflightScreenCaptureAccess', ['bool', []]);
const screens = $.NSScreen.screens;
if (ObjC.unwrap(screens.count) < 1) throw new Error('No active macOS screen session');
const screen = screens.objectAtIndex(0);
const frame = screen.frame;
JSON.stringify({
  accessibility: Boolean($.AXIsProcessTrusted()),
  screenRecording: Boolean($.CGPreflightScreenCaptureAccess()),
  logicalWidth: Math.round(frame.size.width),
  logicalHeight: Math.round(frame.size.height)
});`;

function loadRobot() {
  return import("@jitsi/robotjs")
    .then(module => module.default || module)
    .catch(error => { throw new Error(`Native computer support is unavailable. Install the optional @jitsi/robotjs package and use an interactive desktop session: ${error.message}`); });
}

function assertPoint(robot, x, y, desktop = null) {
  const size = desktop || robot.getScreenSize();
  if (x >= size.width || y >= size.height) throw new Error(`Coordinates (${x}, ${y}) are outside the primary desktop (${size.width}×${size.height}) in logical input coordinates.`);
  return size;
}

export async function queryMacState() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", MAC_PERMISSION_SCRIPT], { timeout: 3_000, windowsHide: true }));
  } catch (error) {
    const diagnostic = String(error.stderr || error.code || "osascript failed").trim().slice(0, 500);
    throw new Error(`Cannot check macOS Accessibility and Screen Recording permissions: ${diagnostic}. Open System Settings > Privacy & Security and grant SYNVOX the required permission.`);
  }
  let state;
  try { state = JSON.parse(String(stdout || "").trim()); }
  catch { throw new Error("macOS permission check returned an invalid result. Open System Settings > Privacy & Security and verify SYNVOX permissions."); }
  for (const field of ["logicalWidth", "logicalHeight"]) {
    if (!Number.isInteger(state?.[field]) || state[field] < 1) throw new Error("macOS permission check did not return primary-screen geometry.");
  }
  return state;
}

async function macDesktopState(payload, queryState, platform) {
  if (platform !== "darwin") return null;
  const state = await queryState();
  if (payload.tool === "computer_snapshot" && state?.screenRecording !== true) {
    throw new Error("macOS Screen Recording permission is required for computer_snapshot. Open System Settings > Privacy & Security > Screen Recording and allow SYNVOX.");
  }
  if (payload.tool !== "computer_snapshot" && state?.accessibility !== true) {
    throw new Error("macOS Accessibility permission is required for computer input. Open System Settings > Privacy & Security > Accessibility and allow SYNVOX.");
  }
  return { width: state.logicalWidth, height: state.logicalHeight };
}

let releaseInput = null;

function releaseHeldInput() {
  const release = releaseInput;
  releaseInput = null;
  try { release?.(); } catch {}
}

export async function executeNativeAction(payload, robotOverride = null, loadRobotImpl = loadRobot, queryMacStateImpl = queryMacState, platform = process.platform) {
  const logicalDesktop = await macDesktopState(payload, queryMacStateImpl, platform);
  const robot = robotOverride || await loadRobotImpl();
  switch (payload.tool) {
    case "computer_snapshot": {
      const logical = logicalDesktop || robot.getScreenSize();
      let bitmap;
      try { bitmap = robot.screen.capture(0, 0, logical.width, logical.height); }
      catch (error) { throw new Error(`Screen capture failed. On macOS allow Screen Recording for SYNVOX; on Windows/Linux use an active interactive desktop session: ${error.message}`); }
      const png = pngFromBgra(Buffer.from(bitmap.image), bitmap);
      return { ok: true, screenshot: { mime: "image/png", base64: png.toString("base64"), width: bitmap.width, height: bitmap.height, logicalWidth: logical.width, logicalHeight: logical.height } };
    }
    case "computer_click":
      assertPoint(robot, payload.x, payload.y, logicalDesktop); robot.moveMouse(payload.x, payload.y); robot.mouseClick(payload.button, payload.clicks === 2); return { ok: true };
    case "computer_move":
      assertPoint(robot, payload.x, payload.y, logicalDesktop); robot.moveMouse(payload.x, payload.y); return { ok: true };
    case "computer_drag": {
      assertPoint(robot, payload.fromX, payload.fromY, logicalDesktop); assertPoint(robot, payload.x, payload.y, logicalDesktop);
      robot.moveMouse(payload.fromX, payload.fromY);
      let pressed = false;
      try {
        robot.mouseToggle("down", "left");
        pressed = true;
        releaseInput = () => robot.mouseToggle("up", "left");
        robot.dragMouse(payload.x, payload.y);
        return { ok: true };
      } finally {
        if (pressed) releaseHeldInput();
      }
    }
    case "computer_type": robot.typeString(payload.text); return { ok: true };
    case "computer_key": {
      const held = [];
      let release = null;
      try {
        for (const modifier of payload.key.modifiers) {
          robot.keyToggle(modifier, "down");
          held.push(modifier);
        }
        release = () => {
          for (const modifier of [...held].reverse()) robot.keyToggle(modifier, "up");
        };
        releaseInput = release;
        robot.keyTap(payload.key.key);
        return { ok: true, key: payload.key };
      } finally {
        if (releaseInput === release) releaseHeldInput();
        // A modifier may throw after a prior modifier was pressed but before
        // releaseInput was registered.
        if (!release && held.length) {
          for (const modifier of [...held].reverse()) {
            try { robot.keyToggle(modifier, "up"); } catch {}
          }
        }
      }
    }
    case "computer_scroll": robot.scrollMouse(payload.deltaX, payload.deltaY); return { ok: true };
    default: throw new Error(`Unknown computer tool: ${payload.tool}`);
  }
}

if (process.send) {
  process.on("message", async payload => {
    if (payload?.type === "cancel") {
      releaseHeldInput();
      return;
    }
    if (payload?.type === "ping") {
      process.send?.({ ok: true, result: { ok: true } });
      return;
    }
    try { process.send?.({ ok: true, result: await executeNativeAction(payload) }); }
    catch (error) { process.send?.({ ok: false, error: error.message }); }
  });
  process.on("SIGTERM", () => {
    releaseHeldInput();
    process.exit(0);
  });
}
