export async function runAntigravityConversationTurn({
  client, conversation, prompt, cwd, signal, onChange = () => {}, agentMode = false, progressMessage = null,
} = {}) {
  const sessionField = agentMode ? 'codeSessionId' : 'sessionId';
  try {
    const result = await client.complete({
      prompt,
      model: conversation.model || null,
      sessionId: conversation[sessionField] || null,
      cwd,
      signal,
    });
    if (result.sessionId) conversation[sessionField] = result.sessionId;
    const message = progressMessage || { role: 'assistant', content: '', createdAt: new Date().toISOString() };
    message.content = String(result.text || '[empty]').trimEnd();
    message.updatedAt = new Date().toISOString();
    delete message.streaming;
    if (!progressMessage) conversation.messages.push(message);
    conversation.updatedAt = message.updatedAt;
    onChange();
    return result;
  } catch (error) {
    if (error.sessionId) conversation[sessionField] = error.sessionId;
    onChange();
    throw error;
  }
}
