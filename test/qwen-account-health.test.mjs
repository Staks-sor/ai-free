import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyQwenHealthResponse } from "../src/providers/qwen/account-health.mjs";

describe("account-health: classify by body (Qwen отдаёт 401 внутри 200)", () => {
  it("200 + Unauthorized в теле → UNAUTHORIZED", () => {
    const r = classifyQwenHealthResponse(200, JSON.stringify({
      success: false, request_id: "x",
      data: { code: "Unauthorized", details: "401 Unauthorized" },
    }));
    assert.equal(r, "UNAUTHORIZED");
  });

  it("200 + unauthorized (lowercase) в теле → UNAUTHORIZED", () => {
    const r = classifyQwenHealthResponse(200, JSON.stringify({
      success: false,
      data: { code: "unauthorized", details: "401 Не авторизован" },
    }));
    assert.equal(r, "UNAUTHORIZED");
  });

  it("200 + success:true → OK", () => {
    const r = classifyQwenHealthResponse(200, JSON.stringify({
      success: true, data: { chats: [] },
    }));
    assert.equal(r, "OK");
  });

  it("200 + мусорное тело (не JSON: WAF-заглушка) → ERROR (валидность не подтверждена)", () => {
    assert.equal(classifyQwenHealthResponse(200, "<html>ok</html>"), "ERROR");
  });

  it("HTTP 401/403 → UNAUTHORIZED", () => {
    assert.equal(classifyQwenHealthResponse(401, ""), "UNAUTHORIZED");
    assert.equal(classifyQwenHealthResponse(403, ""), "UNAUTHORIZED");
  });

  it("HTTP 429 → RATELIMIT", () => {
    assert.equal(classifyQwenHealthResponse(429, ""), "RATELIMIT");
  });

  it("HTTP 5xx → ERROR", () => {
    assert.equal(classifyQwenHealthResponse(502, ""), "ERROR");
  });
});
