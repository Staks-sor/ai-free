import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { qwenAuthRetryAfterReload } from "../src/providers/qwen/browser-proxy.mjs";

// 2026-09-30, инцидент «бесконечный reload воркера»: после auth-reload SPA не
// всегда может обновить JWT (refresh_token мёртв). Ретрай со старым токеном
// гарантированно ловит 401 и рекурсивно перезапускает reload — бесконечный
// цикл по ~17с. Решение: нет свежего токена → giveup (ошибка наверх, ротация
// аккаунта), есть → retry.
describe("qwenAuthRetryAfterReload: ретрай только со свежим токеном", () => {
  const futureJwt = "h." + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".s";
  it("свежий JWT после reload → retry", () => {
    assert.equal(qwenAuthRetryAfterReload(futureJwt), "retry");
  });

  it("SPA не обновил токен (null) → giveup, не зацикливаемся", () => {
    assert.equal(qwenAuthRetryAfterReload(null), "giveup");
  });

  it("пустая строка → giveup", () => {
    assert.equal(qwenAuthRetryAfterReload(""), "giveup");
  });
});
