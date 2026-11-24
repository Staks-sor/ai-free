import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { parseGLMNativeSseCompletion, summarizeGLMNativeSse } from "../src/providers/glm/stream.mjs";

describe("GLM native SSE completion parser", () => {
  it("returns concatenated documented delta content only after a finish reason", () => {
    const result = parseGLMNativeSseCompletion([
      'data: {"choices":[{"delta":{"content":"Hello "}}]}',
      'data: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}]}',
    ].join("\n\n"));

    assert.deepEqual(result, { ok: true, text: "Hello world", terminal: true });
  });

  it("accepts documented full message content with a DONE terminal marker", () => {
    const result = parseGLMNativeSseCompletion([
      'data: {"choices":[{"message":{"content":"Complete answer"}}]}',
      "data: [DONE]",
    ].join("\n\n"));

    assert.deepEqual(result, { ok: true, text: "Complete answer", terminal: true });
  });

  it("rejects partial content without a terminal marker", () => {
    assert.deepEqual(parseGLMNativeSseCompletion('data: {"choices":[{"delta":{"content":"partial"}}]}'), {
      ok: false,
      text: "",
      terminal: false,
      reason: "nonterminal",
    });
  });

  it("rejects explicit errors even if earlier content exists", () => {
    assert.deepEqual(parseGLMNativeSseCompletion([
      'data: {"choices":[{"delta":{"content":"partial"}}]}',
      'data: {"error":{"code":"bad_request"}}',
      "data: [DONE]",
    ].join("\n\n")), {
      ok: false,
      text: "",
      terminal: true,
      reason: "error",
    });
  });

  it("does not treat reasoning-only output as a completion", () => {
    assert.deepEqual(parseGLMNativeSseCompletion([
      'data: {"choices":[{"delta":{"reasoning_content":"private reasoning"},"finish_reason":"stop"}]}',
      "data: [DONE]",
    ].join("\n\n")), {
      ok: false,
      text: "",
      terminal: true,
      reason: "empty",
    });
  });
});

it("accepts only answer-phase chat completion envelopes after data.done", () => {
  const result = parseGLMNativeSseCompletion([
    'event: chat:completion',
    'data: {"type":"chat:completion","data":{"phase":"answer","delta_content":"Hello ","done":false}}',
    'event: chat:completion',
    'data: {"type":"chat:completion","data":{"phase":"answer","delta_content":"world","done":true}}',
  ].join("\n\n"));

  assert.deepEqual(result, { ok: true, text: "Hello world", terminal: true });
});

it("rejects reasoning, unknown phase, and nonterminal chat completion envelopes", () => {
  for (const [phase, done, expected, terminal] of [
    ["reasoning", true, "nonterminal", false],
    ["other", true, "nonterminal", false],
    ["answer", false, "nonterminal", false],
  ]) {
    assert.deepEqual(parseGLMNativeSseCompletion(`data: {"type":"chat:completion","data":{"phase":"${phase}","delta_content":"hidden","done":${done}}}`), {
      ok: false,
      text: "",
      terminal,
      reason: expected,
    });
  }
});


it("reports only observed chat completion phase and completion counters", () => {
  assert.deepEqual(summarizeGLMNativeSse([
    'data: {"type":"chat:completion","data":{"phase":"reasoning","delta_content":"private","done":false}}',
    'data: {"type":"chat:completion","data":{"phase":"answer","delta_content":"visible","done":true}}',
  ].join("\n\n")), {
    phaseValues: ["answer", "reasoning"], doneTrueCount: 1, doneFalseCount: 1, deltaChars: 14,
  });
});

it("only treats answer or done phase as a custom terminal", () => {
  for (const [phase, expected] of [["thinking", false], ["other", false], ["done", true]]) {
    const result = parseGLMNativeSseCompletion(`data: {"type":"chat:completion","data":{"phase":"${phase}","done":true}}`);
    assert.equal(result.terminal, expected);
  }
});

it("rejects non-success primary choice finish reasons even with DONE", () => {
  for (const reason of ["length", "error", "content_filter"]) {
    assert.deepEqual(parseGLMNativeSseCompletion([
      `data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"${reason}"}]}`,
      "data: [DONE]",
    ].join("\n\n")), { ok: false, text: "", terminal: true, reason: "error" });
  }
});

it("uses only the primary standard completion choice", () => {
  assert.deepEqual(parseGLMNativeSseCompletion('data: {"choices":[{"delta":{"content":"primary"},"finish_reason":"stop"},{"delta":{"content":"secondary"},"finish_reason":"stop"}]}'), {
    ok: true, text: "primary", terminal: true,
  });
});
