import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseQwenLoginsFile, resolveQwenAutoLogin, autoLoginAttemptKey } from "../src/providers/qwen/auto-login.mjs";

// 2026-10-02: ручной перелогин не масштабируется — сессии умирают каждые
// ~50 минут. Автологин: logins.txt (email<space>password), человечоподобный
// ввод, тот же persistent-профиль, JWT ловится существующим waitForQwenToken.
describe("parseQwenLoginsFile", () => {
  it("email<пробел>password → карта, мусор игнорируется", () => {
    const txt = [
      "# комментарий",
      "",
      "beullia@mail.ru Beullia370",
      "  epyd9ecdu8@ruutukf.com   epyd9ecdu8  ",
      "битая-строка-без-пароля",
      "a@b.c p@ss w0rd extra",
    ].join("\n");
    const map = parseQwenLoginsFile(txt);
    assert.equal(map.get("beullia@mail.ru"), "Beullia370");
    assert.equal(map.get("epyd9ecdu8@ruutukf.com"), "epyd9ecdu8");
    // лишние токены склеиваются в пароль с пробелами (пароль может содержать пробел? —
    // нет: берём всё после первого пробела как пароль, включая внутренние пробелы)
    assert.equal(map.get("a@b.c"), "p@ss w0rd extra");
    assert.equal(map.size, 3);
  });

  it("пустой/без файла → пустая карта", () => {
    assert.equal(parseQwenLoginsFile("").size, 0);
    assert.equal(parseQwenLoginsFile(null).size, 0);
  });
});

describe("resolveQwenAutoLogin", () => {
  const logins = new Map([["epyd9ecdu8@ruutukf.com", "pw1"]]);

  it("пул-аккаунт с паролем и флагом ON → разрешён", () => {
    const r = resolveQwenAutoLogin({
      account: { id: "acc_x", label: "epyd9ecdu8@ruutukf.com" },
      logins,
      enabled: true,
    });
    assert.equal(r.allowed, true);
    assert.equal(r.password, "pw1");
  });

  it("флаг OFF → отказ (env-гейт обязателен)", () => {
    const r = resolveQwenAutoLogin({
      account: { id: "acc_x", label: "epyd9ecdu8@ruutukf.com" },
      logins,
      enabled: false,
    });
    assert.equal(r.allowed, false);
  });

  it("нет пароля в logins.txt → отказ с причиной", () => {
    const r = resolveQwenAutoLogin({
      account: { id: "acc_x", label: "unknown@mail.ru" },
      logins,
      enabled: true,
    });
    assert.equal(r.allowed, false);
    assert.match(r.reason, /logins/);
  });

  it("default-аккаунт → отказ (только пул)", () => {
    const r = resolveQwenAutoLogin({
      account: { id: "default" },
      logins,
      enabled: true,
    });
    assert.equal(r.allowed, false);
  });

  it("label без @ — не email, отказ", () => {
    const r = resolveQwenAutoLogin({
      account: { id: "acc_x", label: "просто-метка" },
      logins,
      enabled: true,
    });
    assert.equal(r.allowed, false);
  });
});

describe("autoLoginAttemptKey", () => {
  it("один автологин на аккаунт на процесс — ключ детерминирован", () => {
    assert.equal(autoLoginAttemptKey("acc_x"), "autologin:acc_x");
  });
});
