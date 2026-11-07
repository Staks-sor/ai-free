import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findQwenJwt } from "../src/providers/qwen/browser-login.mjs";

const JWT = "eyJhbGciOiJub25lIn0.eyJpZCI6InUxIiwiZXhwIjo5OTk5OTk5OTk5fQ.sig";

describe("findQwenJwt: детект JWT в куках И localStorage (инцидент 2026-09-29)", () => {
  it("токен в куках — как раньше", () => {
    const r = findQwenJwt({ cookies: [{ name: "token", value: JWT }], storageToken: null });
    assert.equal(r.token, JWT);
    assert.equal(r.source, "cookies");
  });

  it("токен ТОЛЬКО в localStorage (Qwen перестал класть в куки) — главный фикс", () => {
    const r = findQwenJwt({ cookies: [{ name: "cna", value: "x" }], storageToken: JWT });
    assert.equal(r.token, JWT);
    assert.equal(r.source, "localStorage");
  });

  it("localStorage приоритетнее при обоих (свежее)", () => {
    const old = "eyJhbGciOiJub25lIn0.eyJpZCI6Im9sZCJ9.sig";
    const r = findQwenJwt({ cookies: [{ name: "token", value: old }], storageToken: JWT });
    assert.equal(r.token, JWT);
    assert.equal(r.source, "localStorage");
  });

  it("previousToken не принимается (re-login должен дать НОВЫЙ jwt)", () => {
    const r = findQwenJwt({ cookies: [{ name: "token", value: JWT }], storageToken: null, previousToken: JWT });
    assert.equal(r, null);
  });

  it("мусор не принимается", () => {
    assert.equal(findQwenJwt({ cookies: [], storageToken: "garbage" }), null);
    assert.equal(findQwenJwt({ cookies: [{ name: "token", value: "no-dot" }], storageToken: null }), null);
    assert.equal(findQwenJwt({ cookies: [], storageToken: null }), null);
  });
});
