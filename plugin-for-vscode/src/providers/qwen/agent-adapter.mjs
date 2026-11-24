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
//
// Восстановление при «The chat is in progress!»:
// QwenChatClient.complete() умеет сам создать НОВЫЙ чат и вернуть в результате
// поле recoveredChatId. Адаптер закрепляет этот chat_id в self.activeChatId, чтобы
// все последующие шаги /code-задачи шли в восстановленный чат, а не в зависший
// старый (runCodeTask не знает про смену чата и передаёт тот же sessionId).

export function createQwenAgentAdapter(qwenClient) {
  const self = {
    supportsImageAttachments: qwenClient.supportsImageAttachments === true,
    // Qwen web chat has a small request budget. One strict repair is enough;
    // repeating ignored tool instructions only burns the user's quota.
    noToolTextRetries: 1,
    // Закреплённый chat_id после восстановления через новый чат.
    // Если задан — используем его вместо пришедшего sessionId.
    activeChatId: null,
  };

  let recoveredTurn = null;
  self.recoverCheckpoint = async function (checkpoint, baseOptions) {
    const result = await qwenClient.recoverCheckpoint(self.activeChatId || baseOptions.sessionId, checkpoint);
    if (!result) return false;
    if (result.notSent === true) return 'not_sent';
    recoveredTurn = { checkpoint, result };
    return true;
  };

  self.complete = async function ({
    sessionId,
    prompt,
    parentMessageId = null,
    thinkingEnabled = false,
    searchEnabled = false,
    model = null,
    images = [],
    signal,
  }) {
    // Если уже восстанавливались — держим тот же свежий чат до конца задачи.
    const chatId = self.activeChatId || sessionId;
    signal?.throwIfAborted();
    const cached = recoveredTurn;
    recoveredTurn = null;
    if (cached && (cached.checkpoint.prompt !== prompt || cached.checkpoint.parentMessageId !== parentMessageId)) {
      throw Object.assign(new Error('Qwen: сохранённый ответ относится к другому checkpoint.'), { code: 'HARNESS_REVIEW_REQUIRED', delivery: 'unknown' });
    }
    const result = cached ? cached.result : await qwenClient.complete({
      chatId,
      prompt,
      parentId: parentMessageId,
      thinking: Boolean(thinkingEnabled),
      search: Boolean(searchEnabled),
      model: model || undefined,
      images,
      // Адаптер работает только в авто-режиме (/code-агент, ACP): включаем
      // цикл авто-повторов при "The chat is in progress!", чтобы автономная
      // задача не падала из-за зависшего turn на сервере Qwen.
      autoRetry: true,
      signal,
    });

    if (result?.recoveredChatId) {
      console.log(`[qwen-agent] recovered into fresh chat_id=${result.recoveredChatId}; sticking with it for the rest of the task.`);
      self.activeChatId = result.recoveredChatId;
      // После перехода в новый чат parentId сбрасывается (свежий контекст),
      // поэтому lastMessageId из результата — корректный parent для следующего шага.
    }

    // runCodeTask парсит result.text как JSON tool-call. Если у Qwen был thinking,
    // его НЕ примешиваем — иначе парсер может споткнуться о префикс «🧠 ...».
    return {
      text: result.text,
      lastAssistantMessageId: result.lastMessageId,
    };
  };

  return self;
}

// Keep the server's account/auth wrapper identical for sends and history reads.
export function createQwenAgentTransport(invoke) {
  return {
    supportsImageAttachments: true,
    complete: options => invoke(client => client.complete(options)),
    recoverCheckpoint: (chatId, checkpoint) => invoke(client => client.recoverCheckpoint(chatId, checkpoint)),
  };
}
