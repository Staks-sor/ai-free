import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeQwenWebModels,
  qwenLiveModelSupportsSearch,
  qwenLiveModelSupportsThinking,
  selectQwenCatalogCookie,
} from "../src/providers/qwen/model-sync.mjs";

function liveModel(id, { search = false, modality = ["text"] } = {}) {
  return {
    id,
    name: id,
    info: {
      is_active: true,
      is_visitor_active: true,
      meta: {
        chat_type: ["t2t"],
        modality,
        capabilities: { thinking: true, search },
      },
    },
  };
}

describe("Qwen live model catalog", () => {
  it("accepts newly published active Qwen models without a code release", () => {
    const models = normalizeQwenWebModels([
      liveModel("qwen4-preview", { search: true, modality: ["text", "image"] }),
    ]);

    assert.equal(models.length, 1);
    assert.equal(models[0].id, "qwen4-preview");
    assert.equal(models[0].search, true);
  });

  it("includes signed-in-only Omni models returned by the authenticated catalog", () => {
    const omni = liveModel("qwen3.8-omni-flash", { modality: ["text", "image", "video", "audio"] });
    omni.info.is_visitor_active = false;
    assert.deepEqual(normalizeQwenWebModels([omni]).map((model) => model.id), ["qwen3.8-omni-flash"]);
  });

  it("does not keep removed preview models when they are absent from the live response", () => {
    const models = normalizeQwenWebModels([
      liveModel("qwen3.7-plus", { search: true }),
    ]);

    assert.deepEqual(models.map((model) => model.id), ["qwen3.7-plus"]);
  });

  it("recognizes Qwen automatic search when the capabilities flag is omitted", () => {
    const model = liveModel("qwen3.7-max");
    delete model.info.meta.capabilities.search;
    model.info.meta.auto_search = true;
    assert.equal(normalizeQwenWebModels([model])[0].search, true);
  });

  it("disables smart search when the selected live model does not support it", () => {
    const catalog = {
      models: [
        { id: "qwen3.7-plus", search: true },
        { id: "qwen3.7-max", search: false },
      ],
    };

    assert.equal(qwenLiveModelSupportsSearch(catalog, "qwen3.7-plus"), true);
    assert.equal(qwenLiveModelSupportsSearch(catalog, "qwen3.7-max"), false);
  });

  it("reports thinking capability for a newly published live model", () => {
    const catalog = { models: normalizeQwenWebModels([liveModel("qwen4-preview")]) };
    assert.equal(qwenLiveModelSupportsThinking(catalog, "qwen4-preview"), true);
    assert.equal(qwenLiveModelSupportsThinking(catalog, "missing"), false);
  });

  it("keeps search enabled when the live catalog is temporarily unavailable", () => {
    assert.equal(qwenLiveModelSupportsSearch(null, "qwen3.7-plus"), true);
  });

  it("uses the ready primary account for live models and falls back to legacy auth", () => {
    const accounts = [
      { id: "old", primary: true, cookieHeader: "expired", invalid: true },
      { id: "ready", cookieHeader: "account-cookie", invalid: false },
    ];
    assert.equal(selectQwenCatalogCookie(accounts, { cookieHeader: "legacy-cookie" }), "account-cookie");
    assert.equal(selectQwenCatalogCookie([], { cookieHeader: "legacy-cookie" }), "legacy-cookie");
  });
});
