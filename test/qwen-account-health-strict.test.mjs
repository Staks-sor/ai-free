import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { classifyQwenHealthResponse, applyQwenHealthVerdict } from "../src/providers/qwen/account-health.mjs";
import { addAccount, loadAccounts } from "../src/providers/qwen/account-store.mjs";

let tmp = "";
let savedEnv;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-health-strict-"));
  savedEnv = process.env.QWEN_ACCOUNTS_FILE;
  process.env.QWEN_ACCOUNTS_FILE = path.join(tmp, "accounts.json");
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.QWEN_ACCOUNTS_FILE;
  else process.env.QWEN_ACCOUNTS_FILE = savedEnv;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function fakeJwt(expSec) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ id: "u1", exp: expSec })}.${b64({})}`;
}

describe("classify: строго — OK только при явном success:true", () => {
  it("200 + WAF-HTML (aliyun_waf) → ERROR, не OK", () => {
    const waf = '<!doctype html><meta name="aliyun_waf_aa" content="ff926c7f"><script>!function(){}</script>';
    assert.equal(classifyQwenHealthResponse(200, waf), "ERROR");
  });

  it("200 + произвольный не-JSON мусор → ERROR", () => {
    assert.equal(classifyQwenHealthResponse(200, "<html>ok</html>"), "ERROR");
    assert.equal(classifyQwenHealthResponse(200, "gateway timeout"), "ERROR");
    assert.equal(classifyQwenHealthResponse(200, ""), "ERROR");
  });

  it("200 + JSON без success:true → ERROR (валидность не подтверждена)", () => {
    assert.equal(classifyQwenHealthResponse(200, JSON.stringify({ data: { chats: [] } })), "ERROR");
  });

  it("200 + success:true → OK", () => {
    assert.equal(classifyQwenHealthResponse(200, JSON.stringify({ success: true, data: {} })), "OK");
  });

  it("200 + success:false + Unauthorized → UNAUTHORIZED (как раньше)", () => {
    const r = classifyQwenHealthResponse(200, JSON.stringify({
      success: false, data: { code: "unauthorized", details: "401 Не авторизован" },
    }));
    assert.equal(r, "UNAUTHORIZED");
  });

  it("HTTP 401/403/429/5xx → как раньше", () => {
    assert.equal(classifyQwenHealthResponse(401, ""), "UNAUTHORIZED");
    assert.equal(classifyQwenHealthResponse(403, ""), "UNAUTHORIZED");
    assert.equal(classifyQwenHealthResponse(429, ""), "RATELIMIT");
    assert.equal(classifyQwenHealthResponse(502, ""), "ERROR");
  });
});

describe("applyQwenHealthVerdict: OK не выводит из таймаута (инцидент 2026-09-29)", () => {
  it("OK: снимает invalid, но resetAt (кулдаун) остаётся нетронутым", () => {
    const future = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    addAccount({ id: "acc_cd", token: fakeJwt(Math.floor(Date.now() / 1000) + 86400), invalid: true, resetAt: future });
    applyQwenHealthVerdict("acc_cd", "OK");
    const a = loadAccounts()[0];
    assert.equal(a.invalid, false, "invalid снят");
    assert.equal(a.resetAt, future, "кулдаун НЕ тронут");
  });

  it("UNAUTHORIZED при живом JWT: кулдаун, не invalid (RGV587-семантика)", () => {
    addAccount({ id: "acc_flag", token: fakeJwt(Math.floor(Date.now() / 1000) + 86400 * 30), invalid: false });
    applyQwenHealthVerdict("acc_flag", "UNAUTHORIZED");
    const a = loadAccounts()[0];
    assert.equal(a.invalid, false);
    assert.ok(a.resetAt, `resetAt установлен, got ${a.resetAt}`);
  });

  it("UNAUTHORIZED при протухшем JWT: честный invalid", () => {
    addAccount({ id: "acc_dead", token: fakeJwt(Math.floor(Date.now() / 1000) - 3600), invalid: false });
    applyQwenHealthVerdict("acc_dead", "UNAUTHORIZED");
    const a = loadAccounts()[0];
    assert.equal(a.invalid, true);
    assert.equal(a.resetAt, null);
  });

  it("ERROR: состояние аккаунта не меняется вообще", () => {
    addAccount({ id: "acc_err", token: "t", invalid: false, resetAt: "2099-01-01T00:00:00.000Z" });
    applyQwenHealthVerdict("acc_err", "ERROR");
    const a = loadAccounts()[0];
    assert.equal(a.invalid, false);
    assert.equal(a.resetAt, "2099-01-01T00:00:00.000Z");
  });

  it("RATELIMIT: ставит resetAt (в часах)", () => {
    addAccount({ id: "acc_rl", token: "t" });
    applyQwenHealthVerdict("acc_rl", "RATELIMIT", { hours: 12 });
    const a = loadAccounts()[0];
    assert.ok(new Date(a.resetAt).getTime() > Date.now());
  });
});
