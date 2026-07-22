import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

const require = createRequire(import.meta.url);
const {
  createNodeRuntimeCandidates,
  parseNodeMajor,
  probeNodeRuntime,
  resolveNodeRuntime,
} = require("../plugin-for-vscode/node-runtime.js");

function fakeSpawn(versions, calls) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    const version = versions.shift();
    queueMicrotask(() => {
      child.stdout.emit("data", `${version}\n`);
      child.emit("close", 0);
    });
    return child;
  };
}

describe("VS Code Node.js runtime", () => {
  it("prefers the IDE runtime over Node.js from PATH", () => {
    const candidates = createNodeRuntimeCandidates({ execPath: "C:\\Program Files\\VS Code\\Code.exe", env: {} });
    assert.equal(candidates[0].command, "C:\\Program Files\\VS Code\\Code.exe");
    assert.deepEqual(candidates[0].envPatch, { ELECTRON_RUN_AS_NODE: "1" });
    assert.equal(candidates[1].command, "node");
  });

  it("accepts a compatible IDE runtime without probing PATH", async () => {
    const calls = [];
    const result = await resolveNodeRuntime({
      execPath: "C:\\Program Files\\VS Code\\Code.exe",
      env: {},
      spawnImpl: fakeSpawn(["v22.18.0"], calls),
    });
    assert.equal(result.command, "C:\\Program Files\\VS Code\\Code.exe");
    assert.equal(result.version, "v22.18.0");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE, "1");
  });

  it("falls back to PATH when an old IDE runtime is used", async () => {
    const calls = [];
    const result = await resolveNodeRuntime({
      execPath: "Code.exe",
      env: {},
      spawnImpl: fakeSpawn(["v16.20.2", "v20.19.0"], calls),
    });
    assert.equal(result.command, "node");
    assert.equal(result.version, "v20.19.0");
    assert.equal(calls.length, 2);
    assert.match(result.attempts[0], /requires Node\.js 18\+/);
  });

  it("probes the current executable successfully", async () => {
    const result = await probeNodeRuntime({
      command: process.execPath,
      envPatch: {},
      label: "test",
    });
    assert.equal(result.ok, true);
    assert.equal(parseNodeMajor(result.version), Number(process.versions.node.split(".")[0]));
  });
});
