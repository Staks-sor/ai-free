import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("background task runner tracing", () => {
  it("records correlated success, failure, and cancellation lifecycles", async () => {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-task-trace-"));
    const previousLogDir = process.env.AI_FREE_LOG_DIR;
    process.env.AI_FREE_LOG_DIR = logDir;
    try {
      const { startTask, isRunning, stopTask } = await import(`../src/window-app/task-runner.mjs?trace-test=${Date.now()}`);
      const successId = `success-${Date.now()}`;
      startTask(successId, "code", async () => "done", "Code agent", {
        requestId: "request-success",
        taskId: "task-success",
        agentId: "agent-main",
      });
      await waitUntil(() => !isRunning(successId));

      const failureId = `failure-${Date.now()}`;
      startTask(failureId, "pipeline", async () => {
        throw Object.assign(new Error("provider unavailable"), { code: "UPSTREAM_DOWN" });
      }, "Pipeline", { taskId: "task-failure" });
      await waitUntil(() => !isRunning(failureId));

      const cancellationId = `cancel-${Date.now()}`;
      startTask(cancellationId, "code", (signal) => new Promise((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", resolve, { once: true });
      }), "Code agent", { taskId: "task-cancelled" });
      assert.equal(stopTask(cancellationId), true);
      await waitUntil(() => !isRunning(cancellationId));

      const entries = fs.readFileSync(path.join(logDir, "ai-free.log"), "utf8")
        .trim().split("\n").filter(Boolean).map(JSON.parse);
      const success = entries.filter((entry) => entry.data?.taskId === "task-success" && entry.event.startsWith("task.lifecycle."));
      assert.deepEqual(success.map((entry) => entry.event), [
        "task.lifecycle.task_created",
        "task.lifecycle.task_started",
        "task.lifecycle.task_finished",
      ]);
      assert.deepEqual(success.map((entry) => entry.data?.stepNumber), [1, 2, 3]);
      assert.ok(success.every((entry) => entry.data?.requestId === "request-success"));
      assert.ok(success.every((entry) => entry.data?.agentId === "agent-main"));
      assert.equal(success.at(-1).data?.outcome, "success");

      const failure = entries.find((entry) => entry.data?.taskId === "task-failure" && entry.event === "task.lifecycle.task_finished");
      assert.equal(failure.data?.outcome, "error");
      assert.equal(failure.data?.errorCode, "UPSTREAM_DOWN");
      const cancellation = entries.find((entry) => entry.data?.taskId === "task-cancelled" && entry.event === "task.lifecycle.task_finished");
      assert.equal(cancellation.data?.outcome, "cancelled");
    } finally {
      if (previousLogDir === undefined) delete process.env.AI_FREE_LOG_DIR;
      else process.env.AI_FREE_LOG_DIR = previousLogDir;
      fs.rmSync(logDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it("does not let an old stopped task clear a replacement task for the same chat", async () => {
    const { startTask, isRunning, stopTask } = await import(`../src/window-app/task-runner.mjs?identity-test=${Date.now()}`);
    const conversationId = `replacement-${Date.now()}`;
    let finishOldTask;
    let finishReplacementTask;

    startTask(conversationId, "code", () => new Promise((resolve) => {
      finishOldTask = resolve;
    }));
    await waitUntil(() => typeof finishOldTask === "function");
    assert.equal(stopTask(conversationId), true);

    startTask(conversationId, "code", () => new Promise((resolve) => {
      finishReplacementTask = resolve;
    }));
    await waitUntil(() => typeof finishReplacementTask === "function");
    finishOldTask();
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(isRunning(conversationId), true);
    finishReplacementTask();
    await waitUntil(() => !isRunning(conversationId));
  });
});

async function waitUntil(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for task");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
