import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  createQwenIncrementalParser,
  createQwenStreamContinuation,
} from "../src/providers/qwen/client.mjs";

// SSE-хелперы в стиле реальных событий Qwen.
function sse(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}
function createdEvent(responseId) {
  return sse({ "response.created": { response_id: responseId, response_index: 0 } });
}
function textChunk(text, responseId) {
  return sse({ choices: [{ delta: { content: text }, index: 0 }], response_id: responseId });
}
function thinkChunk(text, responseId) {
  return sse({ choices: [{ delta: { content: text, phase: "think" }, index: 0 }], response_id: responseId });
}

describe("Qwen incremental parser tracks stream lifecycle for resume/harvest", () => {
  it("records responseId from response.created and terminal markers", () => {
    const parser = createQwenIncrementalParser({});
    parser.push(createdEvent("resp-1"));
    parser.push(textChunk("Hello", "resp-1"));
    parser.push(sse({ choices: [{ delta: { status: "finished" } }], response_id: "resp-1" }));
    const result = parser.finish();
    assert.equal(result.text, "Hello");
    assert.equal(result.responseId, "resp-1");
    assert.equal(result.streamFinished, true, "delta.status=finished is a terminal marker");
  });

  it("treats [DONE] as terminal", () => {
    const parser = createQwenIncrementalParser({});
    parser.push(createdEvent("resp-2"));
    parser.push(textChunk("A", "resp-2"));
    parser.push("data: [DONE]\n\n");
    const result = parser.finish();
    assert.equal(result.streamFinished, true);
    assert.equal(result.responseId, "resp-2");
  });

  it("marks finish_reason as terminal", () => {
    const parser = createQwenIncrementalParser({});
    parser.push(textChunk("B"));
    parser.push(sse({ choices: [{ delta: {}, finish_reason: "stop" }] }));
    const result = parser.finish();
    assert.equal(result.streamFinished, true);
  });

  it("detects mid-stream truncation: content flowed but no terminal marker before finish()", () => {
    const parser = createQwenIncrementalParser({});
    parser.push(createdEvent("resp-3"));
    parser.push(textChunk("partial answer with", "resp-3"));
    // Стрим оборвался: ни [DONE], ни finished, ни finish_reason.
    const result = parser.finish();
    assert.equal(result.streamFinished, false, "no terminal marker => truncated");
    assert.equal(result.truncated, true);
    assert.equal(result.text, "partial answer with");
    assert.equal(result.responseId, "resp-3");
  });

  it("empty stream with no terminal marker is NOT truncated (empty-stream retry owns that case)", () => {
    const parser = createQwenIncrementalParser({});
    const result = parser.finish("");
    assert.equal(result.truncated, false);
    assert.equal(result.streamFinished, false);
  });
});

describe("createQwenStreamContinuation resume session state", () => {
  it("builds resume URL with chat_id and response_id", () => {
    const session = createQwenStreamContinuation({ chatId: "chat-9", responseId: "resp-9" });
    assert.equal(
      session.resumeUrl(),
      "https://chat.qwen.ai/api/v2/chat/completions?chat_id=chat-9&response_id=resp-9",
    );
  });

  it("resumes with an empty JSON body and skips auto-search hallucination prompt", () => {
    const session = createQwenStreamContinuation({ chatId: "chat-9", responseId: "resp-9" });
    const body = JSON.parse(session.resumeBody());
    assert.deepEqual(body, {});
  });

  it("does not consume remaining resume budget on a stream that finished cleanly", () => {
    const session = createQwenStreamContinuation({ chatId: "c", responseId: "r" });
    assert.equal(session.shouldResume({ truncated: false, streamFinished: true }), false);
    assert.equal(session.remainingResumes(), 2);
  });

  it("resumes at most QWEN_RESUME_MAX_ATTEMPTS times (default 2)", () => {
    const session = createQwenStreamContinuation({ chatId: "c", responseId: "r" });
    assert.equal(session.shouldResume({ truncated: true, streamFinished: false }), true);
    session.markResumeAttempt();
    assert.equal(session.shouldResume({ truncated: true, streamFinished: false }), true);
    session.markResumeAttempt();
    assert.equal(session.shouldResume({ truncated: true, streamFinished: false }), false,
      "resume budget exhausted — next step is harvest");
  });

  it("never resumes without a responseId", () => {
    const session = createQwenStreamContinuation({ chatId: "c", responseId: "" });
    assert.equal(session.shouldResume({ truncated: true, streamFinished: false }), false);
  });
});
