import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBlockedSearchFallback,
  buildSearchUrl,
  rewriteBlockedSearchUrl,
  suggestSearchNavigation,
  userExplicitlyWantsGoogle,
  detectSearchBlockHint,
  extractSearchQueryFromTask,
} from "../src/browser/search-engine.mjs";

describe("search-engine", () => {
  it("rewrites Google search URLs to Yandex for Cyrillic queries", () => {
    const out = rewriteBlockedSearchUrl("https://www.google.com/search?q=%D0%9C%D1%83%D1%80%D0%BC%D0%B0%D0%BD%D1%81%D0%BA");
    assert.equal(out.rewritten, true);
    assert.match(out.url, /^https:\/\/yandex\.ru\/search\/\?text=/);
  });

  it("does not rewrite plain google.com homepage", () => {
    const out = rewriteBlockedSearchUrl("https://www.google.com/");
    assert.equal(out.rewritten, false);
    assert.equal(out.url, "https://www.google.com/");
  });

  it("suggests Yandex for Russian news search tasks", () => {
    const s = suggestSearchNavigation("найди Мурманск новости сегодня");
    assert.ok(s);
    assert.equal(s.engineId, "yandex");
    assert.match(s.url, /yandex\.ru\/search/);
    assert.match(s.query, /Мурманск/i);
  });

  it("respects explicit Google request in task heuristics", () => {
    assert.equal(userExplicitlyWantsGoogle("открой google.com"), true);
    assert.equal(suggestSearchNavigation("открой google.com и найди новости"), null);
  });

  it("builds DuckDuckGo for Latin queries by default", () => {
    const url = buildSearchUrl("murmansk news today", { task: "murmansk news today", locale: "en" });
    assert.match(url, /duckduckgo\.com\/\?q=/);
  });

  it("detects Google captcha pages", () => {
    const hint = detectSearchBlockHint({
      title: "Sorry",
      text: "Our systems have detected unusual traffic from your computer network",
    });
    assert.ok(hint);
    assert.match(hint, /yandex/i);
  });

  it("builds a fallback from a blocked Google search URL", () => {
    const fallback = buildBlockedSearchFallback(
      "https://www.google.com/search?q=%D0%BD%D0%BE%D0%B2%D0%BE%D1%81%D1%82%D0%B8",
    );
    assert.ok(fallback);
    assert.equal(fallback.query, "новости");
    assert.equal(fallback.engineId, "yandex");
    assert.match(fallback.url, /^https:\/\/yandex\.ru\/search/);
  });

  it("extracts the query from a Google sorry continue URL", () => {
    const continued = encodeURIComponent("https://www.google.com/search?q=ai-free");
    const fallback = buildBlockedSearchFallback(`https://sorry.google.com/sorry/index?continue=${continued}`);
    assert.ok(fallback);
    assert.equal(fallback.query, "ai-free");
    assert.match(fallback.url, /duckduckgo\.com/);
  });

  it("extracts query from Russian search phrasing", () => {
    assert.equal(extractSearchQueryFromTask("найди Мурманск новости сегодня"), "Мурманск новости сегодня");
  });
});
