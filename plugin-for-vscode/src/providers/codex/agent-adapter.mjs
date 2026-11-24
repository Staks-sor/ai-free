import { parseToolCall } from "../../code-agent/parser.mjs";

import { buildExternalAgentPrompt } from "../../code-agent/external-agent-prompt.mjs";

export function createCodexAgentAdapter(client, { conversationId = null, model = null, onConversationId = null } = {}) {
  let currentConversationId = conversationId;
  const supportsImageAttachments = client?.supportsImageAttachments === true;
  return {
    noToolTextRetries: 1,
    parseToolCall,
    supportsImageAttachments,
    getConversationId: () => currentConversationId,
    async complete({ prompt, signal = null, images = [] }) {
      const result = await client.complete({
        prompt: buildExternalAgentPrompt(prompt),
        sessionId: currentConversationId,
        model,
        agentMode: true,
        signal,
        images: supportsImageAttachments ? images : [],
      });
      if (result.sessionId && result.sessionId !== currentConversationId) {
        currentConversationId = result.sessionId;
        onConversationId?.(currentConversationId);
      }
      return { text: result.text, lastAssistantMessageId: result.turnId || null };
    },
  };
}
