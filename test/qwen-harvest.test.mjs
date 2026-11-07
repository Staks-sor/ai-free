import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { harvestQwenChatMessage } from "../src/providers/qwen/harvest.mjs";

// Формат ответа GET /api/v2/chats/{chatId}?direction=up&limit=10 — как в HAR морды.
function chatHistoryPayload(messages) {
  return {
    code: "SUCCESS",
    success: true,
    data: {
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        ...m.extra,
      })),
    },
  };
}

describe("harvestQwenChatMessage", () => {
  it("returns the saved assistant message matching responseId", async () => {
    const payload = chatHistoryPayload([
      { id: "u1", role: "user", content: "question" },
      { id: "resp-77", role: "assistant", content: "final saved answer" },
    ]);
    const fetcher = async () => payload;
    const result = await harvestQwenChatMessage({ fetcher, chatId: "chat-1", responseId: "resp-77" });
    assert.equal(result.found, true);
    assert.equal(result.text, "final saved answer");
    assert.equal(result.messageId, "resp-77");
  });

  it("matches responseId against response_id field of saved nodes (HAR shape)", async () => {
    const payload = {
      success: true,
      data: {
        messages: [
          { id: "node-1", role: "assistant", content: "branch text", response_id: "resp-88" },
        ],
      },
    };
    const result = await harvestQwenChatMessage({ fetcher: async () => payload, chatId: "c", responseId: "resp-88" });
    assert.equal(result.found, true);
    assert.equal(result.text, "branch text");
  });

  it("returns found:false when the generation is still running (no saved assistant message)", async () => {
    const payload = chatHistoryPayload([
      { id: "u1", role: "user", content: "question" },
    ]);
    const result = await harvestQwenChatMessage({ fetcher: async () => payload, chatId: "c", responseId: "resp-404" });
    assert.equal(result.found, false);
    assert.equal(result.reason, "not_saved_yet");
  });

  it("looks through childrenIds branches when assistant message is nested", async () => {
    // В HAR веб-морды ответ ассистента может быть child-узлом user-сообщения.
    const payload = {
      success: true,
      data: {
        messages: [
          {
            id: "u1",
            role: "user",
            content: "question",
            childrenIds: ["resp-99"],
          },
        ],
      },
    };
    const fetcher = async (opts) => {
      // Первичный запрос не нашёл; пагинация не нужна — сразу отдаём вложенное
      // сообщение вторым вызовом (имитируем fetch по cursor).
      if (opts?.cursor) {
        return {
          success: true,
          data: { messages: [{ id: "resp-99", role: "assistant", content: "nested branch answer" }] },
        };
      }
      return payload;
    };
    const result = await harvestQwenChatMessage({ fetcher, chatId: "c", responseId: "resp-99", fetchChildren: true });
    assert.equal(result.found, true);
    assert.equal(result.text, "nested branch answer");
  });

  it("propagates HTTP failure as found:false with reason=http_error and logs nothing sensitive", async () => {
    const fetcher = async () => { throw new Error("HTTP 500: boom"); };
    const result = await harvestQwenChatMessage({ fetcher, chatId: "c", responseId: "r" });
    assert.equal(result.found, false);
    assert.equal(result.reason, "http_error");
  });
});
