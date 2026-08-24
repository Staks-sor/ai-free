import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  harvestLatestAssistantMessage,
  harvestTransportFailedCompletion,
} from "../src/providers/qwen/harvest.mjs";

// 2026-08-21, полевой инцидент (чат «Qwen Account Pool Implementation»,
// export 1787311091624): транспортный обрыв (AbortError: BodyStreamBuffer /
// net::ERR_ABORTED) ДО прихода первых чанков. POST был доставлен — сервер
// сгенерил полный ответ (16 чанков, done). Catch в #completionRound слепо
// re-POSTнул тот же body (тот же timestamp_ms) → второй юзер-месседж в том
// же чате → sibling-ветка «1/2» под запросом, ответ #1 потерян.
//
// Лечение: после транспортного сбоя на ОТПРАВЛЕННОМ completion-POST —
// harvest истории чата (ждём завершения генерации), re-POST только если
// POST доказуемо не доставлен (в истории нет новых сообщений).

describe("harvestLatestAssistantMessage", () => {
  it("returns the finished assistant answer for a delivered POST (fresh chat)", async () => {
    const history = [
      { id: "u1", role: "user", content: "prompt" },
      { id: "a1", role: "assistant", content: "Final answer from POST #1" },
    ];
    const r = await harvestLatestAssistantMessage({
      fetcher: async () => history,
      chatId: "c1",
      pollMs: 1,
      timeoutMs: 200,
    });
    assert.equal(r.found, true);
    assert.equal(r.text, "Final answer from POST #1");
    assert.equal(r.messageId, "a1");
  });

  it("bails fast with post_not_delivered when history has no new messages", async () => {
    const r = await harvestLatestAssistantMessage({
      fetcher: async () => [],
      chatId: "c1",
      pollMs: 1,
      timeoutMs: 10_000,
    });
    assert.equal(r.found, false);
    assert.equal(r.reason, "post_not_delivered");
  });

  it("ignores messages that existed before the POST (continuing chat snapshot)", async () => {
    const history = [
      { id: "old-u", role: "user", content: "old" },
      { id: "old-a", role: "assistant", content: "old answer" },
    ];
    const r = await harvestLatestAssistantMessage({
      fetcher: async () => history,
      chatId: "c1",
      knownIds: ["old-u", "old-a"],
      pollMs: 1,
      timeoutMs: 10_000,
    });
    assert.equal(r.found, false);
    assert.equal(r.reason, "post_not_delivered");
  });

  it("waits for an in-progress assistant to finish, then returns its text", async () => {
    let call = 0;
    const fetcher = async () => {
      call += 1;
      return call === 1
        ? [{ id: "u1", role: "user", content: "p" }, { id: "a1", role: "assistant", content: "" }]
        : [{ id: "u1", role: "user", content: "p" }, { id: "a1", role: "assistant", content: "done text" }];
    };
    const r = await harvestLatestAssistantMessage({ fetcher, chatId: "c1", pollMs: 1, timeoutMs: 5_000 });
    assert.equal(r.found, true);
    assert.equal(r.text, "done text");
    assert.ok(r.polls >= 2);
  });

  it("does not treat a new user message alone as an answer (keeps polling)", async () => {
    let call = 0;
    const fetcher = async () => {
      call += 1;
      return call < 3 ? [{ id: "u1", role: "user", content: "p" }] : [];
    };
    const r = await harvestLatestAssistantMessage({ fetcher, chatId: "c1", pollMs: 1, timeoutMs: 300 });
    assert.equal(r.found, false);
  });
});

describe("harvestTransportFailedCompletion", () => {
  const historyProxy = (messages) => ({
    proxyApiGet: async () => ({ ok: true, status: 200, json: { data: { messages } } }),
  });

  it("emits full text via onText when nothing was streamed; returns parsed shape", async () => {
    const seen = [];
    const proxy = historyProxy([
      { id: "u1", role: "user", content: "p" },
      { id: "a1", role: "assistant", content: "recovered answer" },
    ]);
    const r = await harvestTransportFailedCompletion({
      chatId: "c1",
      streamedText: "",
      onText: (t) => seen.push(t),
      getProxy: async () => proxy,
      pollMs: 1,
      timeoutMs: 200,
    });
    assert.ok(r, "must return parsed");
    assert.equal(r.text, "recovered answer");
    assert.equal(r.lastMessageId, "a1");
    assert.equal(r.harvested, true);
    assert.equal(r.streamFinished, true);
    assert.equal(seen.join(""), "recovered answer");
  });

  it("emits only the missing tail when a prefix was already streamed", async () => {
    const seen = [];
    const proxy = historyProxy([
      { id: "u1", role: "user", content: "p" },
      { id: "a1", role: "assistant", content: "partial full complete" },
    ]);
    const r = await harvestTransportFailedCompletion({
      chatId: "c1",
      streamedText: "partial ",
      onText: (t) => seen.push(t),
      getProxy: async () => proxy,
      pollMs: 1,
      timeoutMs: 200,
    });
    assert.equal(seen.join(""), "full complete");
    assert.equal(r.text, "partial full complete");
  });

  it("returns null when the POST was not delivered (caller may re-POST)", async () => {
    const proxy = historyProxy([]);
    const r = await harvestTransportFailedCompletion({
      chatId: "c1",
      streamedText: "",
      getProxy: async () => proxy,
      pollMs: 1,
      timeoutMs: 200,
    });
    assert.equal(r, null);
  });

  it("returns null when getProxy itself throws (transport totally dead)", async () => {
    const r = await harvestTransportFailedCompletion({
      chatId: "c1",
      getProxy: async () => { throw new Error("proxy dead"); },
      pollMs: 1,
      timeoutMs: 100,
    });
    assert.equal(r, null);
  });
});
