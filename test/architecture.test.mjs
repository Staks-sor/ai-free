import fs from "node:fs";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { AI_FREE_VERSION as ROOT_VERSION } from "../src/config.mjs";
import { AI_FREE_VERSION as PLUGIN_VERSION } from "../plugin-for-vscode/src/config.mjs";
import {
  ECONOMYOS_FALLBACK_MODELS,
  OPENAI_COMPAT_MODELS,
  uiModelCatalog,
} from "../src/providers/model-catalog.mjs";
import {
  MODELS as API_MODELS,
  modelsList,
} from "../api/models.mjs";

describe("architecture invariants", () => {
  it("keeps desktop and VS Code agent context implementations in sync", () => {
    const files = [
      "agent-orchestrator/context-assembler.mjs",
      "agent-orchestrator/index.mjs",
      "agent-orchestrator/project-instructions.mjs",
      "code-agent/compact-prompt.mjs",
      "code-agent/native-tools.mjs",
      "code-agent/loop-helpers.mjs",
      "code-agent/prompt.mjs",
      "code-agent/run.mjs",
      "logging/task-trace.mjs",
      "window-app/agent-task.mjs",
      "window-app/ui-styles.mjs",
    ];
    for (const file of files) {
      const desktop = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
      const plugin = fs.readFileSync(new URL(`../plugin-for-vscode/src/${file}`, import.meta.url), "utf8");
      assert.equal(plugin, desktop, file);
    }
  });

  it("keeps desktop and VS Code compatible API bridges in sync", () => {
    for (const file of ["openai-handler.mjs", "tool-calls.mjs", "stream-retry.mjs"]) {
      const desktop = fs.readFileSync(new URL(`../api/${file}`, import.meta.url), "utf8");
      const plugin = fs.readFileSync(new URL(`../plugin-for-vscode/api/${file}`, import.meta.url), "utf8");
      assert.equal(plugin, desktop, file);
    }
    const desktopSse = fs.readFileSync(new URL("../src/providers/deepseek/sse.mjs", import.meta.url), "utf8");
    const pluginSse = fs.readFileSync(new URL("../plugin-for-vscode/src/providers/deepseek/sse.mjs", import.meta.url), "utf8");
    assert.equal(pluginSse, desktopSse, "providers/deepseek/sse.mjs");
  });

  it("keeps root and VS Code model catalogs in sync", () => {
    const rootCatalog = fs.readFileSync(new URL("../src/providers/model-catalog.mjs", import.meta.url), "utf8");
    const pluginCatalog = fs.readFileSync(
      new URL("../plugin-for-vscode/src/providers/model-catalog.mjs", import.meta.url),
      "utf8",
    );
    assert.equal(pluginCatalog, rootCatalog);
  });

  it("keeps desktop and VS Code diagnostics in sync", () => {
    const desktop = fs.readFileSync(new URL("../src/window-app/diagnostics.mjs", import.meta.url), "utf8");
    const plugin = fs.readFileSync(
      new URL("../plugin-for-vscode/src/window-app/diagnostics.mjs", import.meta.url),
      "utf8",
    );
    assert.equal(plugin, desktop);
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

  it("keeps EconomyOS model selection available when its live catalog is offline", () => {
    assert.ok(ECONOMYOS_FALLBACK_MODELS.length > 1);
    assert.ok(ECONOMYOS_FALLBACK_MODELS.some((model) => model.id === "openai-gpt-56-sol-pro"));
    assert.equal(
      uiModelCatalog().providers.economyos.models.length,
      ECONOMYOS_FALLBACK_MODELS.length,
    );
  });

  it("exposes current ChatGPT modes and hides retired ChatGPT models", () => {
    const ids = uiModelCatalog().providers.chatgpt.models.map((model) => model.id);
    assert.ok(ids.includes("gpt-5.5-instant"));
    assert.ok(ids.includes("gpt-5.6-sol-high"));
    assert.ok(ids.includes("gpt-5.6-sol-pro-extended"));
    assert.ok(!ids.includes("gpt-4o"));
    assert.ok(!ids.includes("o3-mini"));
  });

  it("reads displayed versions from product package.json files", () => {
    const rootPackage = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const pluginPackage = JSON.parse(
      fs.readFileSync(new URL("../plugin-for-vscode/package.json", import.meta.url), "utf8"),
    );
    assert.equal(ROOT_VERSION, rootPackage.version);
    assert.equal(PLUGIN_VERSION, pluginPackage.version);
    assert.equal(ROOT_VERSION, PLUGIN_VERSION);
    assert.equal(ROOT_VERSION, "0.4.14");
  });
});
