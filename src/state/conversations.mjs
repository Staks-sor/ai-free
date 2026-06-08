// Хелперы для работы с conversation: список для UI, авто-генерация title из первого
// сообщения, проверка «надо ли переименовать».

export function conversationList(state) {
  return state.conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    workspace: conversation.workspace,
    mode: conversation.mode || "fast",
    provider: conversation.provider || "deepseek",
    model: conversation.model || "",
    coderMode: conversation.coderMode === true,
    hardwareMode: conversation.hardwareMode === true,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
  }));
}

// Из первого сообщения юзера делаем компактный title для чата.
// Убираем "/code " префикс, схлопываем пробелы, режем до 64 символов.
export function makeConversationTitle(prompt) {
  const clean = String(prompt || "")
    .replace(/^\/code\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "New chat";

  const withoutTrailingPunctuation = clean.replace(/[.!?;:,\s]+$/u, "");
  const title = withoutTrailingPunctuation.slice(0, 64).trim();
  if (!title) return "New chat";
  return title.length < withoutTrailingPunctuation.length ? `${title}...` : title;
}

export function shouldAutoTitle(conversation) {
  return conversation.autoTitle !== false && (!conversation.title || conversation.title === "New chat");
}
