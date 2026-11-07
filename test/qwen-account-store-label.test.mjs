import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadAccounts,
  saveAccounts,
  addAccount,
  removeAccount,
  setAccountLabel,
} from "../src/providers/qwen/account-store.mjs";

let tmp = "";
let savedEnv = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-acc-label-"));
  savedEnv = process.env.QWEN_ACCOUNTS_FILE;
  process.env.QWEN_ACCOUNTS_FILE = path.join(tmp, "accounts.json");
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.QWEN_ACCOUNTS_FILE;
  else process.env.QWEN_ACCOUNTS_FILE = savedEnv;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("account-store: label (почта как человекочитаемая метка слота)", () => {
  it("setAccountLabel ставит и перезаписывает метку", () => {
    addAccount({ id: "acc_x", token: "t" });
    assert.equal(setAccountLabel("acc_x", "beullia@mail.ru"), true);
    assert.equal(loadAccounts()[0].label, "beullia@mail.ru");
    assert.equal(setAccountLabel("acc_x", "other@mail.ru"), true);
    assert.equal(loadAccounts()[0].label, "other@mail.ru");
  });

  it("setAccountLabel для несуществующего id -> false, файл не падает", () => {
    assert.equal(setAccountLabel("acc_nope", "x@y.z"), false);
  });

  it("пустая метка сохраняется как пустая строка", () => {
    addAccount({ id: "acc_y", token: "t", label: "old@mail.ru" });
    setAccountLabel("acc_y", "");
    assert.equal(loadAccounts()[0].label, "");
  });

  it("addAccount сохраняет label при создании (flow добавления аккаунта)", () => {
    addAccount({ id: "acc_z", token: "t", label: "nisa@mail.ru" });
    assert.equal(loadAccounts()[0].label, "nisa@mail.ru");
  });

  it("label переживает markValid/markInvalid-циклы (перелогин не стирает метку)", async () => {
    const { markValid, markInvalid } = await import("../src/providers/qwen/account-store.mjs");
    addAccount({ id: "acc_w", token: "t", label: "keep@mail.ru" });
    markInvalid("acc_w");
    markValid("acc_w", { token: "t2" });
    assert.equal(loadAccounts()[0].label, "keep@mail.ru");
  });
});
