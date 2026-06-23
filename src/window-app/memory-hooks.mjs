// Window-app хелперы для async memory.

import { enqueueChatTurnSave } from "../memory/async-queue.mjs";
import { formatAgentMetaFooter } from "./agent-task.mjs";

function stripAgentFooter(text) {
  return String(text || "").replace(/\n\n---\n🧠[\s\S]*$/, "").trimEnd();
}

export function scheduleChatMemorySave({
  conversation,
  body = {},
  workspacePath,
  userPrompt,
  assistantText,
}) {
  if (conversation?.memoryEnabled === false || body.memoryEnabled === false) return;
  enqueueChatTurnSave({
    userPrompt,
    assistantText,
    workspaceRoot: workspacePath,
  });
}

export function createCodeMemorySavedHandler({
  conversation,
  progressMessage,
  workspaceRoot,
  state,
  saveWindowState,
}) {
  return ({ count }) => {
    const meta = {
      ...(conversation.lastAgentMeta || {}),
      memorySaved: Number(count) || 0,
      memoryPending: false,
    };
    conversation.lastAgentMeta = meta;
    progressMessage.content = `${stripAgentFooter(progressMessage.content)}${formatAgentMetaFooter(meta)}`.trimEnd();
    progressMessage.updatedAt = new Date().toISOString();
    conversation.updatedAt = progressMessage.updatedAt;
    saveWindowState(workspaceRoot, state);
  };
}
