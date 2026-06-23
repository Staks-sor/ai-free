// Сохранение обычного чата в память (фоново, с фильтром шума).

import { addMemory } from "./store.mjs";

const SAVE_HINT = /\b(error|fix|fixed|bug|crash|decide|decision|implement|config|remember|architecture|refactor|deploy|install|fail|issue|важно|запомни|ошибк|баг|решени|архитект|конфиг)\b/ui;

export function shouldSaveChatTurn(userPrompt = "", assistantText = "") {
  const combined = `${userPrompt}\n${assistantText}`;
  if (combined.length < 24) return false;
  return SAVE_HINT.test(combined);
}

export function saveChatTurn({ userPrompt = "", assistantText = "", workspaceRoot = "" } = {}) {
  if (!shouldSaveChatTurn(userPrompt, assistantText)) return null;

  const content = [
    `User: ${String(userPrompt).trim()}`,
    `Assistant: ${String(assistantText).trim()}`,
  ].join("\n").slice(0, 2400);

  return addMemory({
    type: "note",
    content,
    tags: [],
    workspace: String(workspaceRoot || ""),
    meta: { source: "chat" },
  });
}
