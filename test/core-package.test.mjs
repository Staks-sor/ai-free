import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  PROVIDER_CATALOG,
  OPENAI_COMPAT_MODELS,
  getProviderCatalog,
  getProviderIds,
  findModel,
  findProviderModel,
} from "../packages/core/src/providers/model-catalog.mjs";

import {
  LANGUAGES,
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  createTranslator,
} from "../packages/core/src/i18n/index.mjs";

import { parseToolCall, extractFirstJsonObject } from "../packages/core/src/code-agent/parser.mjs";
import { parseFrontmatter, serializeFrontmatter } from "../packages/core/src/memory/markdown.mjs";
import { buildFtsMatchQuery } from "../packages/core/src/memory/search/fts-query.mjs";
import { MEMORY_DB, MEMORY_VAULT } from "../packages/core/src/memory/paths.mjs";

import * as desktopCatalog from "../src/providers/model-catalog.mjs";
import * as vscodeCatalog from "../plugin-for-vscode/src/providers/model-catalog.mjs";
import * as desktopI18n from "../src/i18n/index.mjs";
import * as vscodeI18n from "../plugin-for-vscode/src/i18n/index.mjs";
import * as desktopParser from "../src/code-agent/parser.mjs";
import * as vscodeParser from "../plugin-for-vscode/src/code-agent/parser.mjs";

describe("@ai-free/core unified shared package", () => {
  it("exports provider catalog and model resolution utilities", () => {
    assert.ok(PROVIDER_CATALOG.deepseek, "Core must export deepseek catalog");
    assert.ok(PROVIDER_CATALOG.qwen, "Core must export qwen catalog");
    assert.ok(PROVIDER_CATALOG.chatgpt, "Core must export chatgpt catalog");
    assert.ok(OPENAI_COMPAT_MODELS.length > 10, "Core must export OpenAI-compatible model list");
    assert.equal(getProviderCatalog("deepseek").id, "deepseek");
    assert.deepEqual(getProviderIds(), ["deepseek", "qwen", "chatgpt"]);
    assert.ok(findModel("deepseek-v4-pro"), "findModel should locate deepseek-v4-pro");
    assert.ok(findProviderModel("qwen", "qwen3.7-plus"), "findProviderModel should locate qwen3.7-plus");
  });

  it("exports localization across all 9 languages and translator factory", () => {
    const langCodes = Object.keys(LANGUAGES);
    assert.deepEqual(langCodes.sort(), ["ar", "de", "en", "es", "fr", "hi", "pt", "ru", "zh"].sort());
    assert.equal(DEFAULT_LANGUAGE, "ru");
    assert.equal(normalizeLanguage("RU_ru.UTF-8"), "ru");
    assert.equal(normalizeLanguage("pt-BR"), "pt");
    assert.equal(normalizeLanguage("unknown"), "ru");

    const ruTrans = createTranslator("ru");
    assert.equal(ruTrans.t("newChat.title"), "Новый чат");
    assert.equal(ruTrans.t("chat.reasoningProcess"), "Процесс размышления");

    const enTrans = createTranslator("en");
    assert.equal(enTrans.t("newChat.title"), "New chat");
    assert.equal(enTrans.t("chat.reasoningProcess"), "Thought process");
  });

  it("exports robust code-agent tool call parser", () => {
    const text = 'Сейчас я выполню команду.\n```tool_calls\n[{"name": "execute_command", "arguments": {"cmd": "dir"}}]\n```';
    const parsed = parseToolCall(text);
    assert.equal(parsed?.tool, "execute_command");
    assert.equal(parsed?.cmd, "dir");

    const xmlText = '<tool_call name="read_file">{"path": "test.txt"}</tool_call>';
    const parsedXml = parseToolCall(xmlText);
    assert.equal(parsedXml?.tool, "read_file");
    assert.equal(parsedXml?.path, "test.txt");

    const extracted = extractFirstJsonObject('prefix {"a": 1, "b": "hello"} suffix');
    assert.equal(extracted, '{"a": 1, "b": "hello"}');
  });

  it("exports memory markdown frontmatter parser and FTS query builder", () => {
    const parsed = parseFrontmatter("---\ntitle: Note\ntags: [\"ai\"]\n---\nBody text");
    assert.equal(parsed.meta.title, "Note");
    assert.deepEqual(parsed.meta.tags, ["ai"]);
    assert.equal(parsed.content.trim(), "Body text");

    const serialized = serializeFrontmatter({ title: "Note", tags: ["ai"] });
    assert.ok(serialized.includes("title: Note"));

    const fts = buildFtsMatchQuery("hello world");
    assert.ok(fts.length > 0);
    assert.ok(typeof MEMORY_DB === "string");
    assert.ok(typeof MEMORY_VAULT === "string");
  });

  it("desktop and VS Code re-export wrappers provide 100% parity with core", () => {
    assert.deepEqual(desktopCatalog.PROVIDER_CATALOG, PROVIDER_CATALOG);
    assert.deepEqual(vscodeCatalog.PROVIDER_CATALOG, PROVIDER_CATALOG);

    assert.equal(desktopI18n.createTranslator("ru").t("newChat.title"), "Новый чат");
    assert.equal(vscodeI18n.createTranslator("ru").t("newChat.title"), "Новый чат");

    const parsedDesktop = desktopParser.parseToolCall('```json\n{"tool": "run", "arg": 1}\n```');
    const parsedVscode = vscodeParser.parseToolCall('```json\n{"tool": "run", "arg": 1}\n```');
    assert.deepEqual(parsedDesktop, parsedVscode);
  });
});
