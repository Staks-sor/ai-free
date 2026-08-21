import assert from "node:assert/strict";
import { describe, it } from "node:test";
import os from "node:os";
import path from "node:path";

process.env.QWEN_ACCOUNTS_FILE = path.join(os.tmpdir(), "qwen-health-test-" + Date.now() + ".json");

const store = await import("../src/providers/qwen/account-store.mjs");
const { addAccount, loadAccounts, markInvalid, markValid, markRateLimited, formatAccountStatus, removeAccount } = store;

describe("qwen account health & retry", () => {
  it("health module exposes test functions", async () => {
    const health = await import("../src/providers/qwen/account-health.mjs");
    assert.equal(typeof health.testQwenAccount, "function");
    assert.equal(typeof health.testQwenAccounts, "function");
  });

  it("testQwenAccount marks missing account as ERROR without touching store", async () => {
    const { testQwenAccount } = await import("../src/providers/qwen/account-health.mjs");
    const result = await testQwenAccount("acc_nonexistent");
    assert.equal(result.verdict, "ERROR");
    assert.match(result.reason, /not found/);
  });

  it("status lifecycle after health-driven marks", () => {
    addAccount({ id: "acc_h1", token: "jwt-h1" });
    markRateLimited("acc_h1", 3);
    assert.equal(formatAccountStatus(loadAccounts()[0]).code, 1);
    markValid("acc_h1");
    assert.equal(formatAccountStatus(loadAccounts()[0]).code, 2);
    markInvalid("acc_h1");
    assert.equal(formatAccountStatus(loadAccounts()[0]).code, 0);
    removeAccount("acc_h1");
    assert.equal(loadAccounts().length, 0);
  });
});
