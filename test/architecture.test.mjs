import fs from "node:fs";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { AI_FREE_VERSION as ROOT_VERSION } from "../src/config.mjs";
import { AI_FREE_VERSION as PLUGIN_VERSION } from "../plugin-for-vscode/src/config.mjs";
import {
  OPENAI_COMPAT_MODELS,
  uiModelCatalog,
} from "../src/providers/model-catalog.mjs";
import {
  MODELS as API_MODELS,
  modelsList,
} from "../api/models.mjs";

describe("architecture invariants", () => {
  it("keeps root and VS Code model catalogs in sync", () => {
    const rootCatalog = fs.readFileSync(new URL("../src/providers/model-catalog.mjs", import.meta.url), "utf8");
    const pluginCatalog = fs.readFileSync(
      new URL("../plugin-for-vscode/src/providers/model-catalog.mjs", import.meta.url),
      "utf8",
    );
    assert.equal(pluginCatalog, rootCatalog);
  });

  it("uses the shared model catalog for OpenAI-compatible models", () => {
    assert.deepEqual(API_MODELS, OPENAI_COMPAT_MODELS);
    assert.deepEqual(
      modelsList().data.map((model) => model.id),
      OPENAI_COMPAT_MODELS.map((model) => model.name),
    );
  });

  it("exposes non-legacy catalog models in the UI catalog", () => {
    const uiIds = Object.values(uiModelCatalog().providers)
      .flatMap((provider) => provider.models.map((model) => model.id))
      .sort();
    const expected = OPENAI_COMPAT_MODELS
      .filter((model) => model.legacy !== true)
      .map((model) => model.name)
      .sort();
    assert.deepEqual(uiIds, expected);
  });

  it("reads displayed versions from product package.json files", () => {
    const rootPackage = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const pluginPackage = JSON.parse(
      fs.readFileSync(new URL("../plugin-for-vscode/package.json", import.meta.url), "utf8"),
    );
    assert.equal(ROOT_VERSION, rootPackage.version);
    assert.equal(PLUGIN_VERSION, pluginPackage.version);
  });
});
