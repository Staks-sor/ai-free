import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldSyncCookieSnapshot, slotSyncPayload } from "../src/providers/qwen/browser-proxy.mjs";

// 2026-10-02: health-check синкал ТОЛЬКО токен — слот оставался со старыми
// куками от 30.09. Затем shouldInjectQwenCookies (живой токен) разрешал
// инжект протухших кук поверх живой cookie-базы профиля при следующем
// старте воркера → SPA-редирект → «Execution context was destroyed»
// на create_chat. Контракт: при живом минте синкаем ВЕСЬ снапшот
// (токен + куки) одним атомарным обновлением слота.
describe("shouldSyncCookieSnapshot", () => {
  it("живой минт → синкаем куки вместе с токеном", () => {
    assert.equal(shouldSyncCookieSnapshot({ tokenAlive: true }), true);
  });

  it("минта нет → куки не трогаем", () => {
    assert.equal(shouldSyncCookieSnapshot({ tokenAlive: false }), false);
    assert.equal(shouldSyncCookieSnapshot({}), false);
  });
});

// Единая точка для ВСЕХ слот-апдейтов (health, warm-up, silent refresh):
// снапшот с токеном → атомарно токен+куки; без снапшота — только токен.
describe("slotSyncPayload", () => {
  it("снапшот с токеном и куками → атомарный payload", () => {
    const snap = { token: "jwt-a", cookies: [{ name: "acw_tc", value: "x" }] };
    assert.deepEqual(slotSyncPayload({ snapshot: snap, token: "jwt-a" }), {
      token: "jwt-a",
      cookies: [{ name: "acw_tc", value: "x" }],
    });
  });

  it("снапшота нет / без токена → только токен (куки в слоте не трогаем)", () => {
    assert.deepEqual(slotSyncPayload({ snapshot: null, token: "jwt-a" }), { token: "jwt-a" });
    assert.deepEqual(slotSyncPayload({ snapshot: { cookies: [] }, token: "jwt-a" }), { token: "jwt-a" });
  });
});
