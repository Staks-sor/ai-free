import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldPrimeQwenAuth } from "../src/providers/qwen/browser-proxy.mjs";

// 2026-10-02: приминг воркера писал протухший authToken из accounts.json в
// qwen_access_token_state (мой фикс 30.09 «пишем в оба ключа»). SPA видит
// «токен есть» и НЕ минтит → waitForLiveToken ловит протухший → health
// валил живые аккаунты, а warm-up не получал свежего минта. До 30.09 приминг
// писал только мёртвый старый ключ, который SPA не читает — работало.
// Контракт: примим ТОЛЬКО живой токен (exp в будущем); протухший — не трогаем
// localStorage вообще, пусть SPA делает auth-bootstrap сам.
describe("shouldPrimeQwenAuth", () => {
  it("живой токен (exp в будущем) → праймим", () => {
    assert.equal(shouldPrimeQwenAuth({ tokenExp: 1_000_060, nowSec: 1_000_000 }), true);
  });

  it("протухший токен → НЕ праймим (SPA сам минтит через refresh_token)", () => {
    assert.equal(shouldPrimeQwenAuth({ tokenExp: 999_000, nowSec: 1_000_000 }), false);
  });

  it("токена нет / мусор → не праймим", () => {
    assert.equal(shouldPrimeQwenAuth({ tokenExp: 0, nowSec: 1_000_000 }), false);
    assert.equal(shouldPrimeQwenAuth({ tokenExp: null, nowSec: 1_000_000 }), false);
  });
});
