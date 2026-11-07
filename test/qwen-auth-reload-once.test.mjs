import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldAllowAuthReload } from "../src/providers/qwen/browser-proxy.mjs";

// 2026-09-30 вечер, инцидент «33 reload подряд по 3.3с»: сервер отвергает
// сессию ДО exp-клейма (RGV587-class). Переминченный токен проходит exp-гейт,
// ретрай ловит 401, а рекурсивный runProxyFetch получает НОВЫЙ кадр стека с
// alreadyAuthReloaded=false — цикл бесконечен. Инвариант: ОДИН reload на
// верхнеуровневый вызов; флаг обязан пробрасываться в рекурсию.
describe("shouldAllowAuthReload: один reload на вызов", () => {
  it("первый вызов (флага нет) → reload разрешён", () => {
    assert.equal(shouldAllowAuthReload({ alreadyAuthReloaded: false }), true);
  });

  it("повторный кадр после reload-ретрая (флаг проброшен) → reload ЗАПРЕЩЁН", () => {
    assert.equal(shouldAllowAuthReload({ alreadyAuthReloaded: true }), false);
  });
});
