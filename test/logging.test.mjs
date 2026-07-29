import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  createFileLogger,
  redactLogData,
  resolveLogDirectory,
  withLogSpan,
} from "../src/logging/logger.mjs";

const tempDirectories = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("structured file logging", () => {
  it("uses ~/.ai-free/logs unless an explicit directory is configured", () => {
    assert.equal(
      resolveLogDirectory({ homeDir: "/home/tester", env: {} }),
      path.join("/home/tester", ".ai-free", "logs"),
    );
    assert.equal(
      resolveLogDirectory({ homeDir: "/home/tester", env: { AI_FREE_LOG_DIR: "/tmp/custom-logs" } }),
      path.resolve("/tmp/custom-logs"),
    );
  });

  it("writes JSON lines with stable diagnostics fields and redacts secrets", () => {
    const logDir = makeTempDirectory();
    const logger = createFileLogger({ component: "test", logDir, surface: "desktop" });
    logger.info("provider.request", {
      provider: "qwen",
      model: "qwen3",
      authorization: "Bearer secret-token",
      nested: { apiKey: "sk-private", status: 429 },
    });

    const entries = readEntries(path.join(logDir, "ai-free.log"));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].level, "info");
    assert.equal(entries[0].component, "test");
    assert.equal(entries[0].surface, "desktop");
    assert.equal(entries[0].event, "provider.request");
    assert.equal(entries[0].data.authorization, "[REDACTED]");
    assert.equal(entries[0].data.nested.apiKey, "[REDACTED]");
    assert.equal(entries[0].data.nested.status, 429);
    assert.ok(entries[0].timestamp);
    assert.equal(typeof entries[0].pid, "number");
  });

  it("redacts credentials embedded in strings without hiding useful error details", () => {
    const result = redactLogData({
      message: "HTTP 401 Authorization: Bearer abc.def.ghi cookie=session=private",
      password: "hunter2",
      status: 401,
    });
    assert.doesNotMatch(result.message, /abc\.def\.ghi|private/);
    assert.equal(result.password, "[REDACTED]");
    assert.equal(result.status, 401);
  });

  it("rotates bounded log files before they exceed the configured size", () => {
    const logDir = makeTempDirectory();
    const logger = createFileLogger({
      component: "rotation",
      logDir,
      maxBytes: 420,
      maxFiles: 3,
    });
    for (let index = 0; index < 12; index += 1) {
      logger.info("rotation.entry", { index, detail: "x".repeat(100) });
    }

    assert.ok(fs.existsSync(path.join(logDir, "ai-free.log")));
    assert.ok(fs.existsSync(path.join(logDir, "ai-free.log.1")));
    assert.ok(fs.readdirSync(logDir).filter((name) => name.startsWith("ai-free.log")).length <= 3);
  });

  it("logs start, success and failure around decorated async operations", async () => {
    const logDir = makeTempDirectory();
    const logger = createFileLogger({ component: "span", logDir });

    const successful = withLogSpan(logger, "provider.complete", async (value) => value * 2, {
      details: (value) => ({ provider: "economyos", inputSize: String(value).length }),
    });
    assert.equal(await successful(21), 42);

    const failing = withLogSpan(logger, "provider.complete", async () => {
      const error = new Error("rate limited");
      error.status = 429;
      throw error;
    });
    await assert.rejects(failing(), /rate limited/);

    const entries = readEntries(path.join(logDir, "ai-free.log"));
    assert.deepEqual(entries.map((entry) => entry.event), [
      "provider.complete.start",
      "provider.complete.success",
      "provider.complete.start",
      "provider.complete.error",
    ]);
    assert.equal(typeof entries[1].data.durationMs, "number");
    assert.match(entries[3].error.stack, /rate limited/);
    assert.equal(entries[3].error.status, 429);
  });
});

function makeTempDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-logs-"));
  tempDirectories.push(directory);
  return directory;
}

function readEntries(filePath) {
  return fs.readFileSync(filePath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}
