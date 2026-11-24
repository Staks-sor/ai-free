export function resolveUploadConversation(state, body) {
  const sessionId = body.chatSessionId || body.sessionId || null;
  const conversation = body.conversationId
    ? state.conversations.find(c => c.id === body.conversationId)
    : sessionId
      ? state.conversations.find(c => c.provider === 'deepseek' && c.sessionId === sessionId)
      : state.conversations.find(c => c.id === state.activeConversationId && c.provider === 'deepseek');
  if ((body.conversationId || sessionId) && (!conversation || conversation.provider !== 'deepseek')) {
    throw new Error('Для загрузки выберите существующий чат DeepSeek');
  }
  if (sessionId && conversation?.sessionId !== sessionId) throw new Error('Сессия не принадлежит выбранному чату');
  return conversation || null;
}
