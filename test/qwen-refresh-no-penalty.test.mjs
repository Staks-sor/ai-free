import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// САНДБОКС ПУЛА (инцидент 30.09): ТОЛЬКО через настоящую QWEN_ACCOUNTS_FILE
// во временном файле. Никогда не трогаем реальный ~/.qwen-cli/accounts.json.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-refresh-penalty-"));
process.env.QWEN_ACCOUNTS_FILE = path.join(tmpDir, "accounts.json");
fs.writeFileSync(
  process.env.QWEN_ACCOUNTS_FILE,
  JSON.stringify([
    { id: "acc_a", label: "a@t.ru", token: "tok-a", cookies: [], invalid: false, resetAt: null },
  ]),
);
process.env.QWEN_AUTOLOGIN = "0";

const { makeQwenAccountRefreshClient } = await import("../api/openai-handler.mjs");
const { loadAccounts } = await import("../src/providers/qwen/account-store.mjs");

const authError = new Error(
  'Qwen createChat: no id in response: {"success":false,"data":{"code":"unauthorized","details":"Token has expired, please log in again."}}',
);

function slotState() {
  const acc = loadAccounts().find((a) => a.id === "acc_a");
  return { invalid: acc.invalid, resetAt: acc.resetAt };
}

// Инцидент 03.10 21:35–22:02: JWT живёт 1 час; каждый естественный exp =
// 401 → markQwenAccountOnUpstreamError ставил 6ч кулдаун ДО попытки silent
// refresh, и refresh проходил УСПЕШНО — аккаунт работал дальше, но слот
// считался мёртвым до конца кулдауна. За длинную сессию все 12 слотов
// «сожглись» → пул пуст → default → ручное окно логина.
describe("makeQwenAccountRefreshClient: естественный exp ≠ наказание", () => {
  it("успешный silent refresh не ставит кулдаун/invalid", async () => {
    const refreshClient = makeQwenAccountRefreshClient("acc_a", {
      refreshFromProfile: async () => ({ token: "fresh", cookies: [], userId: "" }),
    });
    const client = await refreshClient(authError);
    assert.equal(client.token, "fresh");
    const state = slotState();
    assert.equal(state.invalid, false, "invalid не должен ставиться");
    assert.equal(state.resetAt, null, "кулдаун не должен ставиться при успешном refresh");
  });

  it("провал refresh → маркировка + throw (ротация)", async () => {
    const refreshClient = makeQwenAccountRefreshClient("acc_a", {
      refreshFromProfile: async () => {
        throw new Error("живой прокси не выдал свежий JWT за 25s");
      },
    });
    await assert.rejects(() => refreshClient(authError), /Token has expired/);
    const state = slotState();
    assert.ok(state.resetAt || state.invalid, "после провала refresh слот должен быть наказан");
  });
});
