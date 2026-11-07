import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// САНДБОКС ПУЛА (инцидент 30.09): ТОЛЬКО через настоящую QWEN_ACCOUNTS_FILE
// во временном файле. Никогда не трогаем реальный ~/.qwen-cli/accounts.json.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-stream-rot-"));
process.env.QWEN_ACCOUNTS_FILE = path.join(tmpDir, "accounts.json");
fs.writeFileSync(
  process.env.QWEN_ACCOUNTS_FILE,
  JSON.stringify([
    { id: "acc_a", label: "a@t.ru", token: "tok-a", cookies: [], invalid: false, resetAt: null },
    { id: "acc_b", label: "b@t.ru", token: "tok-b", cookies: [], invalid: false, resetAt: null },
  ]),
);
process.env.QWEN_AUTOLOGIN = "0"; // в тесте автологина нет — чистая ротация

const { handleQwenStream } = await import("../api/openai-handler.mjs");

function fakeRes() {
  const chunks = [];
  return {
    chunks,
    statusCode: 0,
    headers: {},
    destroyed: false,
    writableEnded: false,
    setHeader(k, v) { this.headers[k] = v; },
    write(x) { chunks.push(String(x)); return true; },
    end(x) { if (x) chunks.push(String(x)); this.writableEnded = true; },
    on() {}, once() {}, emit() {},
  };
}

// Инцидент 02.10 (TG «[Error] Qwen createChat: ... unauthorized»): epyd умер
// 401-in-200, silent refresh тоже кинул — и ошибка улетела КЛИЕНТУ, хотя в
// логе обещано «ротация на следующий». Причина: refreshClient бросает из
// catch-блока внутреннего цикла → прыжок обходит account-ротацию ниже.
describe("handleQwenStream: silent refresh упал → ротация, а не ошибка клиенту", () => {
  it("второй аккаунт подхватывает запрос после провала первого", async () => {
    let createChatCalls = 0;
    const createChat = async () => {
      createChatCalls += 1;
      if (createChatCalls === 1) {
        throw new Error(
          'Qwen createChat: no id in response: {"success":false,"data":{"code":"unauthorized","details":"Token has expired, please log in again."}}',
        );
      }
      return "chat-b";
    };
    const client = {
      complete: async ({ onText }) => {
        onText?.("Привет из ротации");
        return { text: "Привет из ротации" };
      },
    };
    const res = fakeRes();
    await handleQwenStream(client, null, "prompt", "qwen3.8-max", "qwen3-max", res, {
      accountId: "acc_a",
      createChat: () => createChat(),
      getClientForAccount: async () => client,
      refreshClient: async () => {
        throw new Error("живой прокси не выдал свежий JWT за 25s — нужна проверка/ре-логин");
      },
    });
    const out = res.chunks.join("");
    assert.match(out, /Привет из ротации/);
    assert.match(out, /\[DONE\]/);
    assert.equal(createChatCalls, 2);
  });
});
