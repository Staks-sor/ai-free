import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  addAccount,
  loadAccounts,
  decodeQwenTokenExp,
  markQwenAuthFailure,
} from "../src/providers/qwen/account-store.mjs";

let tmp = "";
let savedEnv;

function fakeJwt(expSec) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ id: "u1", exp: expSec })}.${b64({})}`;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-auth-mark-"));
  savedEnv = process.env.QWEN_ACCOUNTS_FILE;
  process.env.QWEN_ACCOUNTS_FILE = path.join(tmp, "accounts.json");
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.QWEN_ACCOUNTS_FILE;
  else process.env.QWEN_ACCOUNTS_FILE = savedEnv;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("decodeQwenTokenExp (клиентский разбор JWT без подписи)", () => {
  it("достаёт exp в миллисекундах", () => {
    assert.equal(decodeQwenTokenExp(fakeJwt(1_800_000_000)), 1_800_000_000_000);
  });
  it("мусор -> null, не бросает", () => {
    assert.equal(decodeQwenTokenExp("garbage"), null);
    assert.equal(decodeQwenTokenExp(""), null);
    assert.equal(decodeQwenTokenExp(undefined), null);
  });
});

describe("markQwenAuthFailure: 401 при живом JWT = риск-флаг, не смерть", () => {
  it("живой JWT -> кулдаун (invalid снят, resetAt в будущем)", () => {
    const now = Date.now();
    const liveExpSec = Math.floor((now + 30 * 86400 * 1000) / 1000); // +30 дней
    addAccount({ id: "acc_flagged", token: fakeJwt(liveExpSec) });
    markQwenAuthFailure("acc_flagged", { cooldownMs: 6 * 3600 * 1000, now });
    const a = loadAccounts()[0];
    assert.equal(a.invalid, false);
    const resetAt = new Date(a.resetAt).getTime();
    assert.ok(Math.abs(resetAt - (now + 6 * 3600 * 1000)) < 60_000, `resetAt ~ now+6h, got ${a.resetAt}`);
  });

  it("просроченный JWT -> честный invalid (ждёт перелогина)", () => {
    const now = Date.now();
    const deadExpSec = Math.floor((now - 86400 * 1000) / 1000); // вчера
    addAccount({ id: "acc_dead", token: fakeJwt(deadExpSec) });
    markQwenAuthFailure("acc_dead", { cooldownMs: 6 * 3600 * 1000, now });
    const a = loadAccounts()[0];
    assert.equal(a.invalid, true);
    assert.equal(a.resetAt, null);
  });

  it("нет токена в слоте -> invalid (безопасный дефолт)", () => {
    addAccount({ id: "acc_notok" });
    markQwenAuthFailure("acc_notok", { now: Date.now() });
    assert.equal(loadAccounts()[0].invalid, true);
  });

  it("несуществующий id -> false", () => {
    assert.equal(markQwenAuthFailure("acc_nope"), false);
  });
});
