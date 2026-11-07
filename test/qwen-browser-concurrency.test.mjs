import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Инцидент 03.10 «субагенты через ai-free не работают, с GLM напрямую —
// работают»: при 1 живом аккаунте главный стрим + 4 субагента (stream:false)
// сериализовались в ОДНУ страницу браузера (QWEN_BROWSER_CONCURRENCY=1):
// ttft главного взлетал до 93с и 426с, субагенты стояли в очереди минутами,
// а их запросы были невидимы в консоли (не-стрим путь не логировал stages).
// Фикс: дефолт параллельных страниц = 2 (страницы того же persistent-контекста,
// это НЕ второй Chromium на профиле — убийца cookie-баз 29.09 был отдельным
// launchPersistentContext на том же profileDir).
const { resolveQwenBrowserConcurrency } = await import("../src/providers/qwen/browser-proxy.mjs");

describe("resolveQwenBrowserConcurrency", () => {
  it("дефолт = 2 (субагенты + главный стрим параллельно)", () => {
    assert.equal(resolveQwenBrowserConcurrency({}), 2);
  });

  it("env QWEN_BROWSER_CONCURRENCY переопределяет", () => {
    assert.equal(resolveQwenBrowserConcurrency({ QWEN_BROWSER_CONCURRENCY: "3" }), 3);
    assert.equal(resolveQwenBrowserConcurrency({ QWEN_BROWSER_CONCURRENCY: "1" }), 1);
  });

  it("клампит мусор в [1..4]", () => {
    assert.equal(resolveQwenBrowserConcurrency({ QWEN_BROWSER_CONCURRENCY: "0" }), 1);
    assert.equal(resolveQwenBrowserConcurrency({ QWEN_BROWSER_CONCURRENCY: "-5" }), 1);
    assert.equal(resolveQwenBrowserConcurrency({ QWEN_BROWSER_CONCURRENCY: "99" }), 4);
    assert.equal(resolveQwenBrowserConcurrency({ QWEN_BROWSER_CONCURRENCY: "abc" }), 2);
  });
});
