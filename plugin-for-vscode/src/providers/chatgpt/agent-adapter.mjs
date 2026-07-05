// Адаптер ChatGPTChatClient → интерфейс, который ждёт runCodeTask (code-agent).
//
// runCodeTask написан под DeepSeek-API и ожидает у клиента:
//   .complete({ sessionId, parentMessageId, ..., prompt }) → { text, lastAssistantMessageId }
//
// У ChatGPT контекст диалога ведётся самим веб-интерфейсом через conversationId:
// каждое сообщение шага агента уходит в ту же веб-сессию, и модель видит всю
// предыдущую историю (system prompt + результаты инструментов). Поэтому адаптер
// хранит conversationId внутри себя и обновляет его после первого ответа
// (ChatGPT выдаёт id только после первого сообщения).
//
// parentMessageId от code-agent игнорируем — цепочку контекста держит conversationId.

export function createChatGPTAgentAdapter(chatGPTClient, { conversationId = null, onConversationId = null, images = [] } = {}) {
  let convId = conversationId || null;
  // Картинки прикрепляем только на ПЕРВОМ шаге — чтобы модель увидела их вместе
  // с задачей. На последующих шагах (результаты инструментов) картинок нет.
  let pendingImages = Array.isArray(images) ? images : [];

  return {
    getConversationId: () => convId,

    async complete({ prompt }) {
      const imagesToSend = pendingImages;
      pendingImages = [];
      const result = await chatGPTClient.complete({ prompt, conversationId: convId, images: imagesToSend });
      if (result.conversationId && result.conversationId !== convId) {
        convId = result.conversationId;
        onConversationId?.(convId);
      }
      return {
        text: result.text,
        lastAssistantMessageId: result.lastMessageId || null,
      };
    },
  };
}
