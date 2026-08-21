import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { recoverTruncatedQwenStream } from "../src/providers/qwen/client.mjs";

function sse(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

// Проверка сквозного конвейера: обрыв → resume-POST → склейка текста,
// обрыв → resume не помог → harvest из истории. Всё на fake-прокси.
describe("recoverTruncatedQwenStream end-to-end with injected proxy", () => {
  it("resumes the broken stream and concatenates the tail onto partial text", async () => {
    // Первый resume-ответ: сервер продолжает с того же response_id
    // и честно завершает (finish_reason).
    const resumeStream =
      sse({ "response.created": { response_id: "resp-1", response_index: 0 } }) +
      sse({ choices: [{ delta: { content: " the rest." } }, ], response_id: "resp-1" }) +
      sse({ choices: [{ delta: {}, finish_reason: "stop" }], response_id: "resp-1" }) +
      "data: [DONE]\n\n";

    const calls = [];
    const proxy = {
      async proxyFetchStream({ url, body, onRawChunk }) {
        calls.push({ url, body });
        onRawChunk(resumeStream);
        return { ok: true, status: 200, contentType: "text/event-stream", text: resumeStream };
      },
      async proxyApiGet() {
        throw new Error("harvest must not be reached");
      },
    };

    const liveDeltas = [];
    const result = await recoverTruncatedQwenStream({
      chatId: "chat-1",
      truncated: { text: "Partial answer", thinkingText: "", responseId: "resp-1", truncated: true },
      onText: (t) => liveDeltas.push(t),
      getProxy: async () => proxy,
      debug: false,
    });

    assert.equal(result.resumed, true);
    assert.equal(result.text, "Partial answer the rest.");
    assert.equal(result.truncated, false);
    assert.equal(result.streamFinished, true);
    // Живой хвост стримится наружу через onText.
    assert.equal(liveDeltas.join(""), " the rest.");
    // Resume — это пустой POST с response_id в query, а не повтор body.
    assert.match(calls[0].url, /chat_id=chat-1&response_id=resp-1$/);
    assert.equal(calls[0].body, "{}");
  });

  it("falls back to harvest from chat history when resume yields nothing", async () => {
    const proxy = {
      proxyFetchStreamCalls: 0,
      async proxyFetchStream() {
        this.proxyFetchStreamCalls += 1;
        // Resume вернул пустоту — генерация на сервере уже не продолжается.
        return { ok: true, status: 200, contentType: "text/event-stream", text: "" };
      },
      async proxyApiGet({ path }) {
        assert.match(path, /\/api\/v2\/chats\/chat-2\?direction=up&limit=10$/);
        return {
          ok: true,
          status: 200,
          json: {
            success: true,
            data: {
              messages: [
                { id: "u1", role: "user", content: "question" },
                // Серверное сохранение начинается с того же текста, что уже
                // успел застримиться до обрыва ("partial").
                { id: "resp-2", role: "assistant", content: "partial answer fully finished by the server" },
              ],
            },
          },
        };
      },
    };

    const harvestTail = [];
    const result = await recoverTruncatedQwenStream({
      chatId: "chat-2",
      truncated: { text: "partial", thinkingText: "", responseId: "resp-2", truncated: true },
      onText: (t) => harvestTail.push(t),
      getProxy: async () => proxy,
    });

    assert.equal(result.harvested, true);
    assert.equal(result.text, "partial answer fully finished by the server");
    assert.equal(result.streamFinished, true);
    // Оба resume-попытки были сделаны до harvest.
    assert.equal(proxy.proxyFetchStreamCalls, 2);
    // Хвост (всё после streamed-префикса "partial") доставлен в onText.
    assert.equal(harvestTail.join(""), " answer fully finished by the server");
  });

  it("returns null when neither resume nor harvest can recover the stream", async () => {
    const proxy = {
      async proxyFetchStream() {
        return { ok: true, status: 200, contentType: "text/event-stream", text: "" };
      },
      async proxyApiGet() {
        return { ok: true, status: 200, json: { success: true, data: { messages: [] } } };
      },
    };
    const result = await recoverTruncatedQwenStream({
      chatId: "chat-3",
      truncated: { text: "partial", thinkingText: "", responseId: "resp-3", truncated: true },
      getProxy: async () => proxy,
    });
    assert.equal(result, null);
  });
});
