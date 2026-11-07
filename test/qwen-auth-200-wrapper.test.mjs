import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { qwenNeedsAuthReload } from "../src/providers/qwen/browser-proxy.mjs";

// 2026-09-30, каскад «no id in response» + unauthorized в теле HTTP 200:
// createChat получает success:false с code:unauthorized, но result.ok=true
// (HTTP 200) — старый детект по !result.ok пропускал его.
describe("qwenNeedsAuthReload: unauthorized в теле 200 (ok=true)", () => {
  it("«no id in response»-обёртка: 200 + unauthorized в теле → reload", () => {
    const body = JSON.stringify({ success: false, request_id: "x", data: { code: "unauthorized", details: "Token has expired, please log in again." } });
    assert.equal(qwenNeedsAuthReload({ status: 200, text: body, ok: true }), true);
  });

  it("прямой HTTP 401 → reload", () => {
    assert.equal(qwenNeedsAuthReload({ status: 401, text: "", ok: false }), true);
  });

  it("успешный ответ без unauthorized → false", () => {
    assert.equal(qwenNeedsAuthReload({ status: 200, text: '{"success":true,"data":{"id":"c1"}}', ok: true }), false);
  });

  it("пустой текст 200 → false (не auth)", () => {
    assert.equal(qwenNeedsAuthReload({ status: 200, text: "", ok: true }), false);
  });
});
