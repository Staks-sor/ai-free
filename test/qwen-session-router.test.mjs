import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-router-test-"));
process.env.QWEN_ACCOUNTS_FILE = path.join(root, "accounts", "accounts.json");
process.env.QWEN_ROUTING_FILE = path.join(root, "routing", "qwen-routing.json");

const { addAccount, markRateLimited } = await import("../src/providers/qwen/account-store.mjs");
const { resolveAccountForUser } = await import("../src/providers/qwen/session-router.mjs");

describe("Qwen session router", () => {
  it("keeps user affinity and moves only after the assigned account becomes unavailable", () => {
    addAccount({ id: "account-a", token: "token-a", lastUsed: 1 });
    addAccount({ id: "account-b", token: "token-b", lastUsed: 2 });

    const first = resolveAccountForUser("friend-1");
    const repeated = resolveAccountForUser("friend-1");
    assert.equal(first.id, "account-a");
    assert.equal(repeated.id, "account-a");

    markRateLimited("account-a", 1);
    const switched = resolveAccountForUser("friend-1");
    assert.equal(switched.id, "account-b");
    assert.equal(fs.statSync(process.env.QWEN_ROUTING_FILE).mode & 0o777, 0o600);
  });
});
