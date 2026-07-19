import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeQwenWebModels,
  qwenLiveModelSupportsSearch,
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
  it("includes the new Qwen3.8 Max preview", () => {
    const models = normalizeQwenWebModels([
      liveModel("qwen3.8-max-preview", { search: true, modality: ["text", "image"] }),
    ]);

    assert.equal(models.length, 1);
    assert.equal(models[0].id, "qwen3.8-max-preview");
    assert.equal(models[0].search, true);
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

  it("keeps search enabled when the live catalog is temporarily unavailable", () => {
    assert.equal(qwenLiveModelSupportsSearch(null, "qwen3.7-plus"), true);
  });
});
