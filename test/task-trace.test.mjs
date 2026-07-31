import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  TASK_LIFECYCLE_EVENTS,
  createTaskTrace,
} from "../src/logging/task-trace.mjs";

describe("task lifecycle tracing", () => {
  it("keeps correlation identifiers and assigns consecutive step numbers", () => {
    const entries = [];
    const trace = createTaskTrace({
      logger: recordingLogger(entries),
      requestId: "request-1",
      taskId: "task-1",
      conversationId: "conversation-1",
      agentId: "agent-main",
    });

    trace.record("message_received", { source: "desktop" });
    trace.record("task_created", { kind: "code" });
    trace.record("provider_request", { provider: "qwen" });
    trace.record("provider_response", { provider: "qwen" });
    trace.record("task_finished", { outcome: "success" });

    assert.deepEqual(entries.map((entry) => entry.event), [
      "task.lifecycle.message_received",
      "task.lifecycle.task_created",
      "task.lifecycle.provider_request",
      "task.lifecycle.provider_response",
      "task.lifecycle.task_finished",
    ]);
    assert.deepEqual(entries.map((entry) => entry.data.stepNumber), [1, 2, 3, 4, 5]);
    for (const entry of entries) {
      assert.equal(entry.data.requestId, "request-1");
      assert.equal(entry.data.taskId, "task-1");
      assert.equal(entry.data.conversationId, "conversation-1");
      assert.equal(entry.data.agentId, "agent-main");
    }
  });

  it("defines the complete observable lifecycle and rejects unknown events", () => {
    assert.deepEqual(TASK_LIFECYCLE_EVENTS, [
      "message_received",
      "task_created",
      "task_started",
      "provider_request",
      "provider_response",
      "tool_started",
      "tool_finished",
      "verification_started",
      "verification_finished",
      "task_finished",
    ]);

    const trace = createTaskTrace({ logger: recordingLogger([]), taskId: "task-2" });
    assert.throws(() => trace.record("made_up_event"), /Unknown task lifecycle event/);
  });

  it("records elapsed time and error outcome without storing prompt content", () => {
    const entries = [];
    let now = 1_000;
    const trace = createTaskTrace({
      logger: recordingLogger(entries),
      taskId: "task-3",
      conversationId: "conversation-3",
      now: () => now,
    });

    trace.record("task_started");
    now = 1_275;
    trace.finish("error", { errorCode: "RATE_LIMITED" });

    assert.equal(entries[1].event, "task.lifecycle.task_finished");
    assert.equal(entries[1].data.outcome, "error");
    assert.equal(entries[1].data.durationMs, 275);
    assert.equal(entries[1].data.errorCode, "RATE_LIMITED");
    assert.equal("prompt" in entries[1].data, false);
  });
});

function recordingLogger(entries) {
  return {
    info(event, data) {
      entries.push({ event, data });
      return true;
    },
  };
}
