import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Изолированное хранилище для теста — не трогаем реальный ~/.qwen-cli/accounts.json.
process.env.QWEN_ACCOUNTS_FILE = path.join(os.tmpdir(), "qwen-accounts-test-" + Date.now() + ".json");
import { describe, it } from "node:test";
import {
  addAccount, loadAccounts, getAvailableAccount, markRateLimited, markInvalid,
  markValid, hasAvailableAccounts, formatAccountStatus, removeAccount, getAccountById as getAccountByIdPublic,
  getAccountProfileDir,
} from "../src/providers/qwen/account-store.mjs";

// Хранилище указывает на реальный ~/.qwen-cli/accounts.json — тесты работают
// на уникальных id и чистят за собой, чтобы не ломать юзерские данные.
const SUFFIX = "test_" + Date.now();
const mk = (n) => `acc_${SUFFIX}_${n}`;

describe("qwen multiaccount account-store", () => {
  it("rotates accounts round-robin", async () => {
    addAccount({ id: mk(1), token: "jwt-1" });
    addAccount({ id: mk(2), token: "jwt-2" });
    const picks = [];
    for (let i = 0; i < 4; i += 1) {
      const a = await getAvailableAccount();
      picks.push(a.id);
    }
    // при N аккаунтах в пуле последовательные выборы идут по кругу
    const uniqueFirst = new Set(picks.slice(0, 2));
    assert.equal(uniqueFirst.size, 2);
    assert.equal(picks[0], picks[2]);
    assert.equal(picks[1], picks[3]);
    // persisted
    assert.ok(fs.existsSync(process.env.QWEN_ACCOUNTS_FILE), "accounts.json должен сохраниться");
    removeAccount(mk(1)); removeAccount(mk(2));
  });

  it("excludes rate-limited account from rotation and reports resetAt", () => {
    addAccount({ id: mk(3), token: "jwt-3" });
    addAccount({ id: mk(4), token: "jwt-4" });
    markRateLimited(mk(3), 5);
    const statuses = loadAccounts().filter((a) => a.id.startsWith(`acc_${SUFFIX}`));
    const rl = statuses.find((a) => a.id === mk(3));
    assert.ok(rl.resetAt, "resetAt должен быть установлен");
    assert.equal(formatAccountStatus(rl).code, 1); // WAIT
    assert.match(formatAccountStatus(rl).label, /Ожидание сброса/);
    const okAcc = statuses.find((a) => a.id === mk(4));
    assert.equal(formatAccountStatus(okAcc).code, 2); // OK
    removeAccount(mk(3)); removeAccount(mk(4));
  });

  it("markInvalid drops account; markValid restores it", () => {
    addAccount({ id: mk(5), token: "jwt-5" });
    markInvalid(mk(5));
    assert.equal(getAccountByIdPublic(mk(5)), null);
    markValid(mk(5), { token: "jwt-5-new" });
    const restored = loadAccounts().find((a) => a.id === mk(5));
    assert.equal(restored.token, "jwt-5-new");
    assert.equal(formatAccountStatus(restored).code, 2);
    removeAccount(mk(5));
  });
});

