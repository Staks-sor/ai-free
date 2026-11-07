import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// САНДБОКС ПУЛА (инцидент 30.09): ТОЛЬКО через настоящую QWEN_ACCOUNTS_FILE
// во временном файле. Никогда не трогаем реальный ~/.qwen-cli/accounts.json.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-sawdelta-"));
process.env.QWEN_ACCOUNTS_FILE = path.join(tmpDir, "accounts.json");
fs.writeFileSync(
  process.env.QWEN_ACCOUNTS_FILE,
  JSON.stringify([
    { id: "acc_a", label: "a@t.ru", token: "tok-a", cookies: [], invalid: false, resetAt: null },
    { id: "acc_b", label: "b@t.ru", token: "tok-b", cookies: [], invalid: false, resetAt: null },
  ]),
);
process.env.QWEN_AUTOLOGIN = "0";

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

// Инцидент 04.10 12:02 (mutrs71ctkxjj): гейт фабрикации проглотил ход на
// 1-й секунде (клиент НИЧЕГО не видел), затем стрим умер на 401 mid-flight.
// sawDelta=true (транспортный) заблокировал ротацию → stream_error клиенту
// с враньём про «окно входа», хотя ротация была безопасна (клиенту не видно).
// Инвариант: если весь видимый текст проглочен гейтом фабрикации — ошибка
// mid-stream ОБЯЗАНА идти в ротацию, а не наружу.
describe("handleQwenStream: гейт проглотил ход → 401 mid-stream → ротация", () => {
  it("второй аккаунт подхватывает после фабрикации+401, клиент видит результат", async () => {
    let createChatCalls = 0;
    const createChat = async () => {
      createChatCalls += 1;
      return `chat-${createChatCalls}`;
    };
    let completeCalls = 0;
    const client = {
      complete: async ({ onText }) => {
        completeCalls += 1;
        if (completeCalls === 1) {
          // Фабрикация в начале ответа — гейт её проглотит (клиент не увидит)
          onText?.("К сожалению, инструменты недоступны в этой сессии. ");
          await new Promise((r) => setTimeout(r, 10));
          // ...и тут стрим умирает на 401 (unauthorized mid-stream)
          throw new Error('completion (browser): 🔒 Сессия Qwen устарела');
        }
        onText?.("Ответ со второго аккаунта");
        return { text: "Ответ со второго аккаунта" };
      },
    };
    const res = fakeRes();
    await handleQwenStream(client, null, "prompt", "qwen3.8-max", "qwen3-max", res, {
      accountId: "acc_a",
      createChat: () => createChat(),
      getClientForAccount: async () => client,
      refreshClient: async () => client,
    });
    const out = res.chunks.join("");
    assert.match(out, /Ответ со второго аккаунта/);
    assert.doesNotMatch(out, /инструменты недоступны/); // прозy фабрикации клиент не видел
    assert.equal(createChatCalls >= 2, true); // ротация состоялась
  });
});
