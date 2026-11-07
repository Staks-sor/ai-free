import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// САНДБОКС ПУЛА (инцидент 30.09): только tmp-файл, реальный accounts.json не трогаем.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-quota-rot-"));
process.env.QWEN_ACCOUNTS_FILE = path.join(tmpDir, "accounts.json");
fs.writeFileSync(
  process.env.QWEN_ACCOUNTS_FILE,
  JSON.stringify([
    { id: "acc_a", label: "a@t.ru", token: "tok-a", cookies: [], invalid: false, resetAt: null },
    { id: "acc_b", label: "b@t.ru", token: "tok-b", cookies: [], invalid: false, resetAt: null },
  ]),
);
process.env.QWEN_AUTOLOGIN = "0"; // в тесте автологина нет — чистая ротация

const {
  makeToolFabricationGate,
  quotaLimitErrorFromText,
  handleQwenStream,
} = await import("../api/openai-handler.mjs");
const { loadAccounts } = await import("../src/providers/qwen/account-store.mjs");

// Живой текст квоты из телеметрии 2026-10-12 (run-2026-10-12T14-40-43-957Z,
// SSE-дельта с phase=answer status=finished): Qwen отдаёт daily limit
// HTTP 200 обычным текстом ответа — не ошибкой.
const QUOTA_TEXT_RU =
  "Вы достигли дневного лимита для Qwen3.8-Max. Обновите подписку или выберите другую модель выше, чтобы продолжить.";

describe("makeToolFabricationGate: квота отделена от фабрикации", () => {
  it("RU daily limit → fabricated()=true и kind()='quota'", () => {
    const gate = makeToolFabricationGate();
    gate.push(QUOTA_TEXT_RU);
    assert.equal(gate.fabricated(), true);
    assert.equal(gate.kind(), "quota");
    assert.equal(gate.flush(), "");
  });

  it("«инструменты недоступны» → kind()='fabrication' (не квота)", () => {
    const gate = makeToolFabricationGate();
    gate.push("К сожалению, все инструменты в текущей сессии недоступны");
    assert.equal(gate.fabricated(), true);
    assert.equal(gate.kind(), "fabrication");
  });

  it("нормальный текст → kind()=null", () => {
    const gate = makeToolFabricationGate();
    gate.push("Читаю файл и делаю расчёт. " + "Анализ продолжается. ".repeat(40));
    assert.equal(gate.fabricated(), false);
    assert.equal(gate.kind(), null);
  });

  it("не дублирует первые символы после прохождения окна (инцидент дублей)", () => {
    const gate = makeToolFabricationGate();
    const long = "Нормальный ответ модели без лимитов. ".repeat(30); // > 500
    const released = gate.push(long);
    assert.equal(released, long, "текст должен уйти клиенту при переполнении окна");
    assert.equal(gate.flush(), "", "буфер уже отдан — flush не должен дублировать");
    assert.equal(gate.fabricated(), false);
  });
});

describe("quotaLimitErrorFromText (не-стрим путь)", () => {
  it("текст квоты → синтетическая rate-limit ошибка", () => {
    const err = quotaLimitErrorFromText(QUOTA_TEXT_RU);
    assert.ok(err, "должна вернуться ошибка");
    assert.equal(err.code, "QWEN_RATE_LIMIT");
    assert.match(err.message, /rate limit/i);
  });

  it("фабрикация «инструменты недоступны» → null (не квота, проходит как есть)", () => {
    assert.equal(quotaLimitErrorFromText("Все инструменты недоступны, отвечу по памяти."), null);
  });

  it("нормальный текст → null", () => {
    assert.equal(quotaLimitErrorFromText("Обычный ответ модели."), null);
  });

  it("упоминание лимита глубже 500 символов → null (не квота в начале)", () => {
    const long = "Анализирую задачу. ".repeat(40) + " Кстати, daily limit бывает у провайдеров.";
    assert.equal(quotaLimitErrorFromText(long), null);
  });
});

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

// Инцидент 2026-10-12 (телеметрия run-...T14-40-43-957Z): daily limit
// приходил СТРИМОМ в теле 200-OK. Гейт ловил его как «фабрикацию» и
// ретраил тот же аккаунт дважды с counterNudge (бесполезно: лимит
// аккаунтный, не чатовый), после чего клиент получал заглушку
// «[Инструменты доступны...]». Ожидание: квота → аккаунт в 24h-кулдаун
// (markRateLimited), запрос подхватывает следующий аккаунт пула.
describe("handleQwenStream: квота в стриме → 24h-кулдаун + ротация аккаунта", () => {
  it("второй аккаунт подхватывает запрос, клиент не видит текст квоты", async () => {
    const clientA = {
      complete: async ({ onText }) => {
        onText?.(QUOTA_TEXT_RU);
        return { text: QUOTA_TEXT_RU };
      },
    };
    const clientB = {
      complete: async ({ onText }) => {
        onText?.("Привет из ротации после квоты");
        return { text: "Привет из ротации после квоты" };
      },
    };
    const res = fakeRes();
    await handleQwenStream(clientA, null, "prompt", "qwen3.8-max", "qwen3-max", res, {
      accountId: "acc_a",
      createChat: async () => `chat-${Math.random().toString(36).slice(2, 8)}`,
      getClientForAccount: async (id) => (id === "acc_a" ? clientA : clientB),
      refreshClient: async (error) => { throw error; },
    });
    const out = res.chunks.join("");
    assert.match(out, /Привет из ротации после квоты/);
    assert.match(out, /\[DONE\]/);
    assert.doesNotMatch(out, /дневного лимита/, "текст квоты не должен утечь клиенту");

    // Аккаунт-источник квоты ушёл в 24h-кулдаун, второй — чист.
    const accounts = loadAccounts();
    const a = accounts.find((x) => x.id === "acc_a");
    const b = accounts.find((x) => x.id === "acc_b");
    assert.ok(a.resetAt, "acc_a должен получить resetAt (rate-limited)");
    const remainingH = (new Date(a.resetAt).getTime() - Date.now()) / 3_600_000;
    assert.ok(remainingH > 23 && remainingH <= 24.1, `кулдаун ~24h, получено ${remainingH.toFixed(2)}h`);
    assert.ok(!b.resetAt, "acc_b не должен получить кулдаун");
  });
});
