// Тело POST /api/v2/chat/completions — синхронизировано с актуальным web API Qwen.

import { randomUUID } from "node:crypto";

export function buildQwenCompletionPayload({
  chatId,
  prompt,
  parentId = null,
  model,
  thinking = false,
  search = false,
  files = null,
} = {}) {
  const fid = randomUUID();
  const assistantFid = randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  const enableThinking = Boolean(thinking);

  return {
    stream: true,
    version: "2.1",
    incremental_output: true,
    chatId,
    parentId: parentId ?? "",
    chat_id: chatId,
    chat_mode: "normal",
    model,
    parent_id: parentId,
    messages: [
      {
        id: null,
        fid,
        parentId,
        parent_id: parentId,
        childrenIds: [assistantFid],
        role: "user",
        content: String(prompt || ""),
        user_action: "chat",
        files: Array.isArray(files) && files.length ? files : [],
        timestamp,
        models: [model],
        model: "",
        chat_type: "t2t",
        feature_config: {
          thinking_enabled: enableThinking,
          output_schema: "phase",
          auto_thinking: enableThinking,
          research_mode: "normal",
          auto_search: Boolean(search),
          ...(enableThinking
            ? { thinking_mode: "Auto", thinking_format: "summary" }
            : {}),
        },
        extra: {
          meta: {
            subChatType: "t2t",
          },
        },
        sub_chat_type: "t2t",
      },
    ],
    timestamp,
  };
}
