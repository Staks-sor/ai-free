import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { harvestAfterFirstContentTimeout } from "../src/providers/qwen/client.mjs";

// 2026-08-24, kilocode over `npm run api` (port 4318): после серии успешных
// tool calls Qwen принимает completion-POST, но не отдаёт ни одного чанка
// за firstContentMs (240s) → EMPTY_UPSTREAM_STREAM. При этом серверная
// генерация часто ПРОДОЛЖАЕТСЯ (proof: инцидент 2026-08-21 — ответ сохранён
// в истории чата). Лечение: вместо мгновенной ошибки — harvest истории.

const timeoutResult = { status: 0, text: "Error: qwen_stream_first_content_timeout" };

const historyProxy = (messages) => ({
  proxyApiGet: async () => ({ ok: true, status: 200, json: { data: { messages } } }),
});

describe("harvestAfterFirstContentTimeout", () => {
  it("is not applicable for non-timeout results", async () => {
    const r = await harvestAfterFirstContentTimeout({
      result: { status: 200, text: "" },
      chatId: "c1",
      getProxy: async () => historyProxy([]),
    });
    assert.equal(r.applicable, false);
    assert.equal(r.recovered, undefined);
  });

  it("harvests the finished answer when the server kept generating", async () => {
    const seen = [];
    const r = await harvestAfterFirstContentTimeout({
      result: timeoutResult,
      chatId: "c1",
      onText: (t) => seen.push(t),
      getProxy: async () => historyProxy([
        { id: "u1", role: "user", content: "p" },
        { id: "a1", role: "assistant", content: "slow but complete answer" },
      ]),
      pollMs: 1,
      timeoutMs: 500,
    });
    assert.equal(r.applicable, true);
    assert.ok(r.recovered, "must recover");
    assert.equal(r.recovered.text, "slow but complete answer");
    assert.equal(r.recovered.harvestedViaTransportRecovery, true);
    assert.equal(seen.join(""), "slow but complete answer");
  });

  it("returns no recovery when the POST was never delivered", async () => {
    const r = await harvestAfterFirstContentTimeout({
      result: timeoutResult,
      chatId: "c1",
      getProxy: async () => historyProxy([]),
      pollMs: 1,
      timeoutMs: 400,
    });
    assert.equal(r.applicable, true);
    assert.equal(r.recovered, null);
  });
});
