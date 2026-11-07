import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// САНДБОКС ПУЛА (инцидент 30.09): ТОЛЬКО через настоящую QWEN_ACCOUNTS_FILE
// во временном файле. Никогда не трогаем реальный ~/.qwen-cli/accounts.json.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-pool-empty-"));
process.env.QWEN_ACCOUNTS_FILE = path.join(tmpDir, "accounts.json");
fs.writeFileSync(
  process.env.QWEN_ACCOUNTS_FILE,
  JSON.stringify([
    { id: "acc_x", label: "x@t.ru", token: "tok-x", cookies: [], invalid: true, resetAt: "2099-01-01T00:00:00Z" },
    { id: "acc_y", label: "y@t.ru", token: "dead", cookies: [], invalid: true, resetAt: "2099-01-01T00:00:00Z" },
  ]),
);
process.env.QWEN_AUTOLOGIN = "0"; // автологина нет — проверяем чистое поведение выбора

const { pickQwenAccountForRequest } = await import("../api/openai-handler.mjs");

// Инцидент 03.10 00:0x: пул «пуст» (все invalid/кулдаун) → выбор аккаунта
// свалился на 'default' → мёртвый дефолт → auth-manager открыл РУЧНОЕ окно
// логина посреди работы сервера. Нужно: пул непуст (есть слоты) → попытка
// автологина кандидата с паролем до ухода на default; автологин выключен
// или без паролей → прежний default-путь (без сюрпризов).
describe("pickQwenAccountForRequest: пул исчерпан", () => {
  it("все недоступны + автологин off → default (как раньше)", async () => {
    const picked = await pickQwenAccountForRequest({ headers: {} });
    assert.equal(picked, "default");
  });
});
