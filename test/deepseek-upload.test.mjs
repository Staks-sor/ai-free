import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  DeepSeekChatClient,
  formatDeepSeekFileFailure,
  isDeepSeekFileFailedStatus,
  isDeepSeekFileReadyStatus,
} from "../src/providers/deepseek/client.mjs";
import { createDeepSeekAgentAdapter } from "../src/providers/deepseek/agent-adapter.mjs";

describe("DeepSeek vision agent adapter", () => {
  it("uploads screenshot bytes once and completes that turn through vision", async () => {
    const uploads = [];
    const completions = [];
    const adapter = createDeepSeekAgentAdapter({
      uploadFile: async (...args) => { uploads.push(args); return "file-screenshot"; },
      complete: async (args) => { completions.push(args); return { text: "ok", lastAssistantMessageId: 7 }; },
    }, { sessionId: "code-session", modelType: "expert", refFileIds: ["file-initial"] });
    const image = { name: "desktop.png", mimeType: "image/png", dataBase64: Buffer.from("pixels").toString("base64") };

    const result = await adapter.complete({ prompt: "inspect the screen", images: [image], signal: AbortSignal.timeout(1000) });

    assert.equal(adapter.supportsImageAttachments, true);
    assert.equal(uploads.length, 1);
    assert.deepEqual(uploads[0], [Buffer.from("pixels"), "image/png", "desktop.png", { chatSessionId: "code-session", signal: completions[0].signal }]);
    assert.deepEqual(completions[0].refFileIds, ["file-initial", "file-screenshot"]);
    assert.equal(completions[0].modelType, "vision");
    assert.match(completions[0].prompt, /vision.*image turn/i);
    assert.equal(result.modelType, "vision");
    assert.equal(result.effectiveModel, "vision");
  });

  it("keeps the selected model and does not upload when no image is present", async () => {
    let uploads = 0;
    const completions = [];
    const adapter = createDeepSeekAgentAdapter({
      uploadFile: async () => { uploads += 1; return "unexpected"; },
      complete: async (args) => { completions.push(args); return { text: "ok" }; },
    }, { sessionId: "code-session", modelType: "expert" });

    const result = await adapter.complete({ prompt: "read the file" });

    assert.equal(uploads, 0);
    assert.equal(completions[0].modelType, "expert");
    assert.equal(completions[0].prompt, "read the file");
    assert.equal(result.modelType, "expert");
    assert.equal(result.effectiveModel, "expert");
  });

  it("uses initial uploaded refs for one vision turn, then restores the selected model", async () => {
    const completions = [];
    const adapter = createDeepSeekAgentAdapter({
      uploadFile: async () => assert.fail("initial refs must not upload again"),
      complete: async (args) => { completions.push(args); return { text: "ok" }; },
    }, { sessionId: "code-session", modelType: "expert", refFileIds: ["file-initial"] });

    await adapter.complete({ prompt: "inspect the supplied image" });
    await adapter.complete({ prompt: "continue with text" });

    assert.equal(completions[0].modelType, "vision");
    assert.deepEqual(completions[0].refFileIds, ["file-initial"]);
    assert.equal(completions[1].modelType, "expert");
    assert.deepEqual(completions[1].refFileIds, []);
  });

  it("does not complete after an upload error or an aborted upload", async () => {
    const image = { name: "desktop.png", mimeType: "image/png", dataBase64: "cGl4ZWxz" };
    let completions = 0;
    const rejected = createDeepSeekAgentAdapter({
      uploadFile: async () => { throw new Error("upload failed"); },
      complete: async () => { completions += 1; },
    }, { sessionId: "code-session" });
    await assert.rejects(rejected.complete({ prompt: "x", images: [image] }), /upload failed/);
    assert.equal(completions, 0);

    const controller = new AbortController();
    const aborted = createDeepSeekAgentAdapter({
      uploadFile: async () => { controller.abort(); return "file-screenshot"; },
      complete: async () => { completions += 1; },
    }, { sessionId: "code-session" });
    await assert.rejects(aborted.complete({ prompt: "x", images: [image], signal: controller.signal }), { name: "AbortError" });
    assert.equal(completions, 0);
  });
});

describe("isDeepSeekFileReadyStatus", () => {
  it("treats PARSING as not ready", () => {
    assert.equal(isDeepSeekFileReadyStatus("PARSING"), false);
    assert.equal(isDeepSeekFileReadyStatus("parsing"), false);
  });

  it("treats PENDING as not ready", () => {
    assert.equal(isDeepSeekFileReadyStatus("PENDING"), false);
  });

  it("treats SUCCESS as ready", () => {
    assert.equal(isDeepSeekFileReadyStatus("SUCCESS"), true);
    assert.equal(isDeepSeekFileReadyStatus("READY"), true);
  });

  it("treats empty as not ready", () => {
    assert.equal(isDeepSeekFileReadyStatus(""), false);
    assert.equal(isDeepSeekFileReadyStatus(null), false);
  });
});

describe("isDeepSeekFileFailedStatus", () => {
  it("treats CONTENT_EMPTY as terminal failure", () => {
    assert.equal(isDeepSeekFileFailedStatus("CONTENT_EMPTY"), true);
    assert.equal(isDeepSeekFileReadyStatus("CONTENT_EMPTY"), false);
  });

  it("formats CONTENT_EMPTY message for user", () => {
    const msg = formatDeepSeekFileFailure(
      { status: "CONTENT_EMPTY", file_name: "test.png" },
      "file-abc",
    );
    assert.match(msg, /CONTENT_EMPTY/);
    assert.match(msg, /test\.png/);
  });
});

describe("DeepSeek invalid message id recovery", () => {
  it("detects biz_code 26 invalid message id errors", () => {
    const error = new Error(
      'Completion rejected: biz_code 26, invalid message id: {"data":{"biz_code":26,"biz_msg":"invalid message id"}}',
    );
    assert.equal(DeepSeekChatClient._isInvalidMessageIdError(error), true);
  });

  it("retries once without parentMessageId when DeepSeek rejects an old parent id", async () => {
    const calls = [];
    const client = Object.create(DeepSeekChatClient.prototype);
    client._completeOnce = async (args) => {
      calls.push(args.parentMessageId ?? null);
      if (calls.length === 1) {
        throw new Error("Completion rejected: biz_code 26, invalid message id");
      }
      return { text: "ok", lastAssistantMessageId: 123 };
    };

    const result = await client._completeWithInvalidMessageRetry(
      { sessionId: "s", prompt: "p", parentMessageId: 42 },
      [],
    );

    assert.deepEqual(calls, [42, null]);
    assert.equal(result.text, "ok");
    assert.equal(result.lastAssistantMessageId, 123);
  });
});

describe("DeepSeek empty completion recovery", () => {
  it("retries one empty completion only when transport confirms it was not sent", async () => {
    const client = new DeepSeekChatClient({ cookieHeader: "", token: "" });
    const requests = [];
    client._completeWithInvalidMessageRetry = async (args) => {
      requests.push(args);
      if (requests.length === 1) {
        throw Object.assign(new Error("DeepSeek stream ended without response content"), {
          code: "EMPTY_UPSTREAM_STREAM",
          delivery: "not_sent",
        });
      }
      return { text: "Ответ по проекту", lastAssistantMessageId: 123 };
    };
    const args = { sessionId: "s", prompt: "что улучшить в проекте?", parentMessageId: 42 };

    const result = await client.complete(args);

    assert.equal(result.text, "Ответ по проекту");
    assert.deepEqual(requests, [args, args]);
  });

  it("does not retry non-empty-stream failures", async () => {
    const client = new DeepSeekChatClient({ cookieHeader: "", token: "" });
    let calls = 0;
    client._completeWithInvalidMessageRetry = async () => {
      calls += 1;
      throw new Error("Completion rejected");
    };

    await assert.rejects(client.complete({ prompt: "x" }), /Completion rejected/);
    assert.equal(calls, 1);
  });

  it("does not retry a DeepSeek rate limit", async () => {
    const client = new DeepSeekChatClient({ cookieHeader: "", token: "" });
    let calls = 0;
    client._completeWithInvalidMessageRetry = async () => {
      calls += 1;
      throw Object.assign(new Error("Лимит запросов DeepSeek"), { code: "DEEPSEEK_RATE_LIMIT" });
    };
    await assert.rejects(client.complete({ prompt: "x" }), /Лимит запросов DeepSeek/);
    assert.equal(calls, 1);
  });
});

describe("DeepSeek finish response parsing", () => {
  it("unwraps a finish message with literal newlines and quoted prose", () => {
    const client = new DeepSeekChatClient({ cookieHeader: "", token: "" });
    const response = '{"tool":"finish","message":"# Обзор\nВ package.json указан "test": "node --test".\nРекомендация."}';
    assert.deepEqual(client.parseToolCall(response), {
      tool: "finish",
      message: '# Обзор\nВ package.json указан "test": "node --test".\nРекомендация.',
    });
  });
});
