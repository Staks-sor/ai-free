import { randomUUID } from "node:crypto";

export const TASK_LIFECYCLE_EVENTS = Object.freeze([
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

const TASK_LIFECYCLE_EVENT_SET = new Set(TASK_LIFECYCLE_EVENTS);

// Creates one correlated trace for a user task. Callers add only privacy-safe
// metadata; prompt and response bodies intentionally do not belong in traces.
export function createTaskTrace({
  logger,
  requestId = null,
  taskId = randomUUID(),
  conversationId = null,
  agentId = null,
  now = Date.now,
} = {}) {
  if (!logger || typeof logger.info !== "function") {
    throw new TypeError("logger.info must be a function");
  }

  const startedAt = now();
  let stepNumber = 0;
  let finished = false;
  const correlation = Object.freeze({ requestId, taskId, conversationId, agentId });

  const record = (event, data = {}) => {
    if (!TASK_LIFECYCLE_EVENT_SET.has(event)) {
      throw new TypeError(`Unknown task lifecycle event: ${event}`);
    }
    if (finished && event !== "task_finished") return false;
    stepNumber += 1;
    const written = logger.info(`task.lifecycle.${event}`, {
      ...correlation,
      stepNumber,
      elapsedMs: Math.max(0, now() - startedAt),
      ...normalizeData(data),
    });
    if (event === "task_finished") finished = true;
    return written;
  };

  return Object.freeze({
    ...correlation,
    record,
    finish(outcome = "success", data = {}) {
      if (finished) return false;
      return record("task_finished", {
        outcome,
        durationMs: Math.max(0, now() - startedAt),
        ...normalizeData(data),
      });
    },
  });
}

function normalizeData(value) {
  if (value == null) return {};
  return typeof value === "object" && !Array.isArray(value) ? value : { value };
}
