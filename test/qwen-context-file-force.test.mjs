import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contextFileConfigForRequest, QWEN_CONTEXT_FILE_FORCE_MIN_CHARS } from "../src/providers/qwen/context-file.mjs";

// 2026-09-30, инцидент «depth 47+ пустые стримы»: Qwen молча отдаёт пустой
// стрим (200 OK, без punish) на промптах ниже thresholdChars=100k. Лимит
// плавающий. Решение: EMPTY_UPSTREAM_STREAM на большом промпте → принудительно
// включаем context-file сплит (thresholdChars=0), история уезжает вложением.

describe("contextFileConfigForRequest: форс context-файла при пустом стриме", () => {
  const base = { thresholdChars: 100_000, inlineChars: 50_000, maxFileChars: 500_000 };

  it("без force конфиг не меняется", () => {
    assert.deepEqual(
      contextFileConfigForRequest(base, { force: false, promptLength: 90_000 }),
      base,
    );
  });

  it("force на большом промпте → thresholdChars=0 (сплит всегда)", () => {
    const cfg = contextFileConfigForRequest(base, { force: true, promptLength: 90_000 });
    assert.equal(cfg.thresholdChars, 0);
    assert.equal(cfg.inlineChars, 50_000, "инлайн-бюджет не трогаем");
  });

  it("force на маленьком промпте бессмысленен — конфиг не меняется", () => {
    assert.deepEqual(
      contextFileConfigForRequest(base, { force: true, promptLength: 5_000 }),
      base,
    );
  });

  it("порог пола — константа порядка 30k", () => {
    assert.ok(QWEN_CONTEXT_FILE_FORCE_MIN_CHARS >= 20_000 && QWEN_CONTEXT_FILE_FORCE_MIN_CHARS <= 50_000);
  });
});
