import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  resolveLlmRepairConfig,
  repairToolCallJsonWithLlm,
} from "../api/tool-call-llm-repair.mjs";

// 2026-09-07: opt-in LLM-фолбэк ремонта tool-call JSON через OpenRouter
// (free-модели). Включается только переменной OPENROUTER_API_KEY; все
// детерминированные ремонты остаются первой линией обороны.

const HERMES_RAW = `[
  { "name": "terminal", "arguments": { "command": "tasklist | grep -i -E "hermes|python" | head -20
    } }
]`;

const HERMES_FIXED = JSON.stringify([
  { name: "terminal", arguments: { command: 'tasklist | grep -i -E "hermes|python" | head -20' } },
]);

const TERMINAL_TOOL = {
  type: "function",
  function: {
    name: "terminal",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
};

function mockFetchSequence(bodies) {
  const calls = [];
  const queue = [...bodies];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const body = queue.shift();
    if (body instanceof Error) throw body;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: body } }] }),
    };
  };
  return { fetchImpl, calls };
}

describe("resolveLlmRepairConfig", () => {
  it("is disabled without OPENROUTER_API_KEY", () => {
    assert.equal(resolveLlmRepairConfig({}), null);
    assert.equal(resolveLlmRepairConfig({ OPENROUTER_API_KEY: "  " }), null);
  });

  it("reads model, timeout and iterations overrides", () => {
    const config = resolveLlmRepairConfig({
      OPENROUTER_API_KEY: "key",
      OPENROUTER_TOOL_REPAIR_MODEL: "x/y:free",
      OPENROUTER_TOOL_REPAIR_TIMEOUT_MS: "5000",
      OPENROUTER_TOOL_REPAIR_ITERATIONS: "3",
    });
    assert.deepEqual(config.models, ["x/y:free"]);
    assert.equal(config.timeoutMs, 5000);
    assert.equal(config.maxIterations, 3);
  });

  it("parses a comma-separated model chain", () => {
    const config = resolveLlmRepairConfig({
      OPENROUTER_API_KEY: "key",
      OPENROUTER_TOOL_REPAIR_MODELS: "a/one:free, b/two:free,,c/three:free",
    });
    assert.deepEqual(config.models, ["a/one:free", "b/two:free", "c/three:free"]);
  });

  it("MODELS chain takes precedence over the single MODEL var", () => {
    const config = resolveLlmRepairConfig({
      OPENROUTER_API_KEY: "key",
      OPENROUTER_TOOL_REPAIR_MODEL: "x/y:free",
      OPENROUTER_TOOL_REPAIR_MODELS: "a/one:free",
    });
    assert.deepEqual(config.models, ["a/one:free"]);
  });

  it("falls back to the curated :free default chain", () => {
    const config = resolveLlmRepairConfig({ OPENROUTER_API_KEY: "key" });
    assert.deepEqual(config.models, [
      "nvidia/nemotron-3-super-120b-a12b:free",
      "nex-agi/nex-n2.5-pro:free",
      "cohere/north-mini-code:free",
      "google/gemma-4-31b-it:free",
    ]);
    assert.equal(config.baseUrl, "https://openrouter.ai/api/v1");
  });
});

describe("repairToolCallJsonWithLlm", () => {
  it("returns null without a key and never touches the network", async () => {
    const { fetchImpl, calls } = mockFetchSequence([HERMES_FIXED]);
    const result = await repairToolCallJsonWithLlm(HERMES_RAW, { env: {}, fetchImpl });
    assert.equal(result, null);
    assert.equal(calls.length, 0);
  });

  it("repairs the Hermes payload through an OpenRouter completion", async () => {
    const { fetchImpl, calls } = mockFetchSequence([HERMES_FIXED]);
    const repaired = await repairToolCallJsonWithLlm(HERMES_RAW, {
      env: { OPENROUTER_API_KEY: "key" },
      fetchImpl,
      tools: [TERMINAL_TOOL],
    });
    assert.equal(repaired.length, 1);
    assert.equal(repaired[0].name, "terminal");
    assert.deepEqual(JSON.parse(repaired[0].arguments), {
      command: 'tasklist | grep -i -E "hermes|python" | head -20',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(calls[0].init.headers.Authorization, "Bearer key");
    // Атрибуция в дашборде OpenRouter: трафик ремонта должен отличаться
    // от прямых обращений клиентских приложений (Hermes и т.п.).
    assert.equal(calls[0].init.headers["X-Title"], "ai-free tool-call repair");
    assert.match(calls[0].init.headers["HTTP-Referer"], /ai-free/);
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.model, resolveLlmRepairConfig({ OPENROUTER_API_KEY: "key" }).models[0]);
    assert.equal(body.temperature, 0);
    assert.equal(body.messages[0].role, "user");
    assert.equal(body.messages[0].content.includes("tasklist | grep"), true);
  });

  it("falls through to the next model in the chain when one errors", async () => {
    const { fetchImpl, calls } = mockFetchSequence([
      new Error("model down"),
      HERMES_FIXED,
    ]);
    const repaired = await repairToolCallJsonWithLlm(HERMES_RAW, {
      env: { OPENROUTER_API_KEY: "key", OPENROUTER_TOOL_REPAIR_MODELS: "a/one:free,b/two:free" },
      fetchImpl,
      tools: [TERMINAL_TOOL],
    });
    assert.equal(repaired.length, 1);
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(calls[0].init.body).model, "a/one:free");
    assert.equal(JSON.parse(calls[1].init.body).model, "b/two:free");
  });

  it("falls through to the next model after validation rejections exhaust iterations", async () => {
    const garbage = JSON.stringify([{ name: "run_shell", arguments: { command: "ls" } }]);
    const { fetchImpl, calls } = mockFetchSequence([
      garbage,
      garbage,
      HERMES_FIXED,
    ]);
    const repaired = await repairToolCallJsonWithLlm(HERMES_RAW, {
      env: { OPENROUTER_API_KEY: "key", OPENROUTER_TOOL_REPAIR_MODELS: "a/one:free,b/two:free" },
      fetchImpl,
      tools: [TERMINAL_TOOL],
    });
    assert.equal(repaired.length, 1);
    assert.equal(calls.length, 3);
    assert.equal(JSON.parse(calls[2].init.body).model, "b/two:free");
  });

  it("retries with validation feedback when the first answer is garbage", async () => {
    const { fetchImpl, calls } = mockFetchSequence([
      "Извини, не понимаю, что чинить.",
      HERMES_FIXED,
    ]);
    const repaired = await repairToolCallJsonWithLlm(HERMES_RAW, {
      env: { OPENROUTER_API_KEY: "key" },
      fetchImpl,
      tools: [TERMINAL_TOOL],
    });
    assert.equal(calls.length, 2);
    assert.equal(repaired.length, 1);

    const secondPrompt = JSON.parse(calls[1].init.body).messages[0].content;
    assert.match(secondPrompt, /rejected/i);
    assert.equal(secondPrompt.includes(HERMES_RAW), true);
  });

  it("strips markdown fences around the LLM answer", async () => {
    const { fetchImpl } = mockFetchSequence(["```json\n" + HERMES_FIXED + "\n```"]);
    const repaired = await repairToolCallJsonWithLlm(HERMES_RAW, {
      env: { OPENROUTER_API_KEY: "key" },
      fetchImpl,
      tools: [TERMINAL_TOOL],
    });
    assert.equal(repaired.length, 1);
  });

  it("rejects unknown tool names against the provided schemas", async () => {
    const wrongName = JSON.stringify([{ name: "run_shell", arguments: { command: "ls" } }]);
    const { fetchImpl, calls } = mockFetchSequence([wrongName, wrongName]);
    const repaired = await repairToolCallJsonWithLlm(HERMES_RAW, {
      env: { OPENROUTER_API_KEY: "key", OPENROUTER_TOOL_REPAIR_MODEL: "x/y:free" },
      fetchImpl,
      tools: [TERMINAL_TOOL],
    });
    assert.equal(repaired, null);
    assert.equal(calls.length, 2);
    const secondPrompt = JSON.parse(calls[1].init.body).messages[0].content;
    assert.match(secondPrompt, /unknown tool names: run_shell/);
  });

  it("feeds back missing required arguments and accepts on the last chance", async () => {
    const missingArgs = JSON.stringify([{ name: "terminal", arguments: {} }]);
    const { fetchImpl, calls } = mockFetchSequence([missingArgs, missingArgs]);
    const repaired = await repairToolCallJsonWithLlm(HERMES_RAW, {
      env: { OPENROUTER_API_KEY: "key", OPENROUTER_TOOL_REPAIR_MODEL: "x/y:free" },
      fetchImpl,
      tools: [TERMINAL_TOOL],
    });
    // Обе итерации без обязательного аргумента: первая даёт фидбек, вторая
    // (последняя) принимается мягко — salvage лучше полной потери хода.
    assert.equal(calls.length, 2);
    const secondPrompt = JSON.parse(calls[1].init.body).messages[0].content;
    assert.match(secondPrompt, /missing required arguments: terminal/);
    assert.equal(repaired.length, 1);
    assert.equal(repaired[0].name, "terminal");
  });

  it("returns null after every model in the chain fails on network errors", async () => {
    const { fetchImpl, calls } = mockFetchSequence([new Error("boom"), new Error("boom2")]);
    const repaired = await repairToolCallJsonWithLlm(HERMES_RAW, {
      env: { OPENROUTER_API_KEY: "key", OPENROUTER_TOOL_REPAIR_MODELS: "a/one:free,b/two:free" },
      fetchImpl,
    });
    assert.equal(repaired, null);
    assert.equal(calls.length, 2);
  });

  it("returns null on HTTP errors with a single-model chain", async () => {
    const calls = [];
    const fetchImpl = async () => {
      calls.push(1);
      return { ok: false, status: 429, json: async () => ({}) };
    };
    const repaired = await repairToolCallJsonWithLlm(HERMES_RAW, {
      env: { OPENROUTER_API_KEY: "key", OPENROUTER_TOOL_REPAIR_MODEL: "x/y:free" },
      fetchImpl,
    });
    assert.equal(repaired, null);
    assert.equal(calls.length, 1);
  });

  it("skips empty and oversized inputs", async () => {
    const { fetchImpl, calls } = mockFetchSequence([HERMES_FIXED]);
    const empty = await repairToolCallJsonWithLlm("   ", {
      env: { OPENROUTER_API_KEY: "key" },
      fetchImpl,
    });
    const oversized = await repairToolCallJsonWithLlm("x".repeat(100_001), {
      env: { OPENROUTER_API_KEY: "key" },
      fetchImpl,
    });
    assert.equal(empty, null);
    assert.equal(oversized, null);
    assert.equal(calls.length, 0);
  });
});
