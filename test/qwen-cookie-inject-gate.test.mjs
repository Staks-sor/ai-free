import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldInjectQwenCookies } from "../src/providers/qwen/browser-proxy.mjs";

// 2026-10-02: прокси инжектил протухший кукиснапшот из accounts.json поверх
// живого профиля. Сервер с протухшими сессионными куками считает сессию
// logged-out → SPA чистит localStorage и не минтит → waitForLiveToken null →
// health валил живые аккаунты. Контракт: инжект кук разрешён ТОЛЬКО при
// живом сохранённом токене (exp в будущем); протухший слот → профиль
// живёт своими куками из cookie-базы.
describe("shouldInjectQwenCookies", () => {
  it("живой токен → куки инжектим (auth.json свежее профиля)", () => {
    assert.equal(shouldInjectQwenCookies({ tokenExp: 1_000_060, nowSec: 1_000_000 }), true);
  });

  it("протухший токен → куки НЕ инжектим (профиль живёт своими)", () => {
    assert.equal(shouldInjectQwenCookies({ tokenExp: 999_000, nowSec: 1_000_000 }), false);
  });

  it("токена нет → не инжектим", () => {
    assert.equal(shouldInjectQwenCookies({ tokenExp: 0, nowSec: 1_000_000 }), false);
    assert.equal(shouldInjectQwenCookies({ tokenExp: null, nowSec: 1_000_000 }), false);
  });
});
