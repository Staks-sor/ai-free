import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  stripToolErrorChips,
  createToolErrorChipFilter,
} from "../api/think-filter.mjs";

// 2026-08-21, полевой лог: деградировавший Qwen шлёт текстом ошибки бэкенда
// «Tool <name> does not exists.» (и вариант «does not exist») вперемешку с
// контентом — чипы утекают в видимый ответ Hermes. Оба варианта орфографии
// встречаются в реальных логах («Tool web search does not exist»,
// «Tool execute_code does not exists»).

describe("stripToolErrorChips", () => {
  it("removes 'does not exists' chips from text", () => {
    const src = "Tool read_file does not exists.Tool terminal does not exists.Замысел: реализация пула.";
    const out = stripToolErrorChips(src);
    assert.equal(out, "Замысел: реализация пула.");
  });

  it("removes 'does not exist' (singular) chips too", () => {
    const src = "Prefix. Tool web_search does not exist. Suffix.";
    const out = stripToolErrorChips(src);
    assert.doesNotMatch(out, /does not exist/);
    assert.match(out, /Prefix/);
    assert.match(out, /Suffix/);
  });

  it("keeps normal prose about tools", () => {
    const src = "The requested tool does not exist in this environment. Use another one.";
    const out = stripToolErrorChips(src);
    assert.equal(out, src);
  });

  it("handles chip-splitting across chunks in streaming filter", () => {
    const out = [];
    const filter = createToolErrorChipFilter({ onText: (t) => out.push(t) });
    filter.push("Tool read_f");
    filter.push("ile does not exists.");
    filter.push("Real answer follows.");
    filter.flush();
    assert.equal(out.join(""), "Real answer follows.");
  });

  it("passes through ordinary text without holding it back on flush", () => {
    const out = [];
    const filter = createToolErrorChipFilter({ onText: (t) => out.push(t) });
    filter.push("Обычный текст, никаких чипов. Tool");
    filter.flush();
    assert.equal(out.join(""), "Обычный текст, никаких чипов. Tool");
  });

  it("suppresses a long run of concatenated chips", () => {
    const chips = Array.from({ length: 12 }, (_, i) => `Tool tool_${i} does not exists.`).join("");
    const out = stripToolErrorChips(chips + "Финальный текст.");
    assert.equal(out, "Финальный текст.");
  });
});
