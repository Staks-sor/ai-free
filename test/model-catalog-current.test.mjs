import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getProviderDefaultModel, findProviderModel, findModel, modelsList, uiModelCatalog } from "../src/providers/model-catalog.mjs";
import * as qwenModels from "../src/providers/qwen/model-sync.mjs";
import { renderWindowHtml } from "../src/window-app/ui-html.mjs";
import { CodexAppServerClient } from "../src/providers/codex/app-server-client.mjs";

describe("current models match the actual provider transport", () => {
  it("does not claim a fixed GPT version for web selectors", () => {
    const web = uiModelCatalog().providers.chatgpt;
    assert.equal(web.defaultModel, "chatgpt-default");
    assert.ok(web.models.every((model) => !/GPT-\d/.test(model.label)));
    assert.equal(findProviderModel("chatgpt", "chatgpt-default").useSessionModel, true);
    assert.equal(web.modelAliases["gpt-5.6-sol-high"], "chatgpt-thinking-high");
    assert.equal(findProviderModel("chatgpt", "gpt-5.6-sol-high").apiModel, "chatgpt-thinking-high");
    assert.equal(findProviderModel("chatgpt", "gpt-5.5-instant").apiModel, "chatgpt-instant");
  });

  it("offers the verified GPT generation only on Codex transport", () => {
    const codex = uiModelCatalog().providers.codex;
    for (const id of ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]) {
      assert.ok(codex.models.some((model) => model.id === id));
      assert.equal(findProviderModel("chatgpt", id), null);
    }
    assert.equal(codex.defaultModel, "codex");
  });

  it("does not advertise CLI-only models on the compatible API that cannot dispatch them", () => {
    assert.equal(findModel("gpt-6.1-sol"), undefined);
    assert.equal(modelsList().data.some((model) => ["codex", "antigravity"].includes(model.owned_by)), false);
    assert.ok(findProviderModel("codex", "gpt-6.1-sol"));
  });

  it("applies a changed Codex model to the next turn of an already attached chat", async () => {
    const requests = [];
    const client = new CodexAppServerClient({ rpc: {
      async start() {},
      async request(method, params) {
        requests.push({ method, params });
        if (method === "thread/start") return { thread: { id: "same-chat" } };
        if (method === "turn/start") return { turn: { id: String(requests.length) } };
        throw new Error(method);
      },
      async waitForTurn() { return { text: "fixture response" }; },
    } });
    await client.complete({ prompt: "first", model: "gpt-6-sol" });
    await client.complete({ prompt: "second", sessionId: "same-chat", model: "gpt-6.1-sol" });
    const turns = requests.filter((request) => request.method === "turn/start");
    assert.deepEqual(turns.map((request) => request.params.model), ["gpt-6-sol", "gpt-6.1-sol"]);
    assert.equal(requests.filter((request) => request.method === "thread/start").length, 1);
  });

  it("prefers the latest verified Qwen web default when present in the live catalog", () => {
    assert.equal(getProviderDefaultModel("qwen"), "qwen3.8-max");
    assert.equal(qwenModels.selectQwenDefaultModel([{ id: "qwen3.7-plus" }, { id: "qwen3.8-max" }]), "qwen3.8-max");
    assert.equal(qwenModels.selectQwenDefaultModel([{ id: "qwen3.7-plus" }, { id: "qwen4-new" }]), "qwen3.7-plus");
    assert.equal(qwenModels.selectQwenDefaultModel([{ id: "qwen4-new" }]), "qwen4-new");
  });

  it("renders the same catalog before and after the API refresh", () => {
    const html = renderWindowHtml({ language: "ru" });
    const embedded = html.match(/let PROVIDER_INFO = (\{[^\n]+\});/);
    assert.ok(embedded, "UI fallback is generated from the shared catalog");
    assert.deepEqual(JSON.parse(embedded[1]), uiModelCatalog().providers);
    assert.ok(html.includes("info.modelAliases?.[savedModel]"), "saved selector aliases stay readable");
  });

  it("keeps version-neutral DeepSeek web routes and verified GLM/Gemini defaults", () => {
    const catalog = uiModelCatalog().providers;
    assert.ok(catalog.deepseek.models.every((model) => !/v4/i.test(model.label)));
    assert.equal(catalog.glm.defaultModel, "glm-5.3-flash");
    assert.equal(catalog.antigravity.defaultModel, "gemini-3.8-flash-medium");
    assert.equal(catalog.googleai.defaultModel, "google-ai-mode");
  });
});
