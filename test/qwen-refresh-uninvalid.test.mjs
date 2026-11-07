import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { updateAccountFromProfile, loadAccounts, saveAccounts } from "../src/providers/qwen/account-store.mjs";

// 2026-09-29, инцидент «пул вымер после refresh»: updateAccountFromProfile
// обновлял token, но НЕ снимал invalid — аккаунт с живым refresh_token
// оставался «Недействителен», ротация его пропускала, пул вырождался в
// fallback на default. refresh (обновление токена из профиля) по смыслу
// снимает auth-invalid; антибот-кулдаун (resetAt) НЕ трогаем.

function makeJwt(expMs) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u", exp: Math.floor(expMs / 1000) })}.sig`;
}

describe("updateAccountFromProfile: снятие invalid при refresh", () => {
  let tmp;
  beforeEach(() => {
    // САНДБОКС: только QWEN_ACCOUNTS_FILE — стор читает именно его.
    // Инцидент 2026-09-30: тест с несуществующей QWEN_HOME_OVERRIDE писал
    // в РЕАЛЬНЫЙ ~/.qwen-cli/accounts.json и уничтожил пул из 12 аккаунтов.
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-refresh-test-"));
    process.env.QWEN_ACCOUNTS_FILE = path.join(tmp, "accounts.json");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.QWEN_ACCOUNTS_FILE;
  });

  it("обновление токена снимает invalid, но НЕ трогает антибот-кулдаун", () => {
    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    saveAccounts([
      { id: "acc_x", label: "x@y.z", token: makeJwt(Date.now() - 1000), invalid: true, resetAt },
    ]);
    const ok = updateAccountFromProfile("acc_x", { token: makeJwt(Date.now() + 3600_000) });
    assert.equal(ok, true);
    const acc = loadAccounts()[0];
    assert.equal(acc.invalid, false, "invalid должен сняться: refresh = живая сессия");
    assert.equal(acc.resetAt, resetAt, "антибот-кулдаун не трогаем");
  });

  it("вызов без token не меняет invalid (только cookies — не refresh)", () => {
    saveAccounts([{ id: "acc_x", token: "t", invalid: true }]);
    updateAccountFromProfile("acc_x", { cookies: [] });
    assert.equal(loadAccounts()[0].invalid, true, "invalid снимается только вместе с новым токеном");
  });
});
