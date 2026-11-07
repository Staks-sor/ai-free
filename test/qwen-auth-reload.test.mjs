import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { qwenNeedsAuthReload } from "../src/providers/qwen/browser-proxy.mjs";

// 2026-09-29: access-JWT живёт ~17-20 минут. SPA обновляет его только при
// загрузке страницы. При 401-in-200 (unauthorized в теле) надо перезагрузить
// воркер-страницу (SPA сам сделает auth.qwen.ai/api/v2/auths/refresh),
// прочитать свежий токен и повторить fetch.
describe("qwenNeedsAuthReload: 401-in-200 требует reload воркера", () => {
  it("Token has expired в теле 200 → reload", () => {
    const body = JSON.stringify({ success: false, data: { code: "unauthorized", details: "Token has expired, please log in again." } });
    assert.equal(qwenNeedsAuthReload({ status: 200, text: body, ok: false }), true);
  });

  it("401 Unauthorized без expires → reload", () => {
    const body = JSON.stringify({ success: false, data: { code: "unauthorized", details: "401 Не авторизован" } });
    assert.equal(qwenNeedsAuthReload({ status: 200, text: body, ok: false }), true);
  });

  it("успешный ответ → false", () => {
    assert.equal(qwenNeedsAuthReload({ status: 200, text: '{"success":true}', ok: true }), false);
  });

  it(" punish-ответ → false (это антибот, не auth; им занимается солвер)", () => {
    assert.equal(qwenNeedsAuthReload({ status: 200, text: "<!doctype html><title>punish</title>", ok: false }), false);
  });
});
