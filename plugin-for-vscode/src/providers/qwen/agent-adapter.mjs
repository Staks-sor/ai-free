// Адаптер QwenChatClient → интерфейс, который ждёт runCodeTask (code-agent).
//
// runCodeTask написан под DeepSeek-API и ожидает у клиента:
//   .complete({ sessionId, parentMessageId, modelType, thinkingEnabled, searchEnabled, prompt })
//   → { text, lastAssistantMessageId }
//
// QwenChatClient использует другие имена:
//   .complete({ chatId, parentId, thinking, search, prompt })
//   → { text, lastMessageId, thinkingText }
//
// Адаптер просто переименовывает поля туда-обратно. Без правок самого QwenChatClient
// и без правок runCodeTask — оба остаются независимыми.

export function createQwenAgentAdapter(qwenClient) {
  return {
    async complete({
      sessionId,
      prompt,
      parentMessageId = null,
      thinkingEnabled = false,
      searchEnabled = false,
      model = null,
    }) {
      const result = await qwenClient.complete({
        chatId: sessionId,
        prompt,
        parentId: parentMessageId,
        thinking: Boolean(thinkingEnabled),
        search: Boolean(searchEnabled),
        model: model || undefined,
      });
      // runCodeTask парсит result.text как JSON tool-call. Если у Qwen был thinking,
      // его НЕ примешиваем — иначе парсер может споткнуться о префикс «🧠 ...».
      return {
        text: result.text,
        lastAssistantMessageId: result.lastMessageId,
      };
    },
  };
}
