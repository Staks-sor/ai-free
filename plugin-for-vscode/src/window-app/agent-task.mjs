// Хелперы для запуска code-agent из window-app server.

import { resolveAgentTaskInput } from "../code-agent/task-input.mjs";

export const AGENT_TASK_EMPTY_HELP =
  "Напиши задачу после /code или /skill <id>. Примеры:\n" +
  "• /code создай файл notes.txt\n" +
  "• /skill bug-fix исправь падение при старте\n" +
  "• /skill code-review проверь src/code-agent/";

export function resolveConversationAgentTask(prompt, conversation, {
  autoCodeMode = false,
  autoBrowserMode = false,
} = {}) {
  return resolveAgentTaskInput(prompt, {
    skillId: conversation.skillId || null,
    coderMode: conversation.coderMode === true,
    hardwareMode: conversation.hardwareMode === true,
    autoCodeMode,
    autoBrowserMode,
  });
}

export function buildAgentTaskOptions(conversation, body, { hardwareMode, systemPrompt, agentInput }) {
  const skillId = agentInput?.skillId || conversation.skillId || body.skillId || null;
  return {
    systemPrompt,
    skillId,
    browserOnly: agentInput?.browserOnly === true,
    memoryEnabled: conversation.memoryEnabled !== false && body.memoryEnabled !== false,
    autoSkill: !skillId && conversation.autoSkill !== false && body.autoSkill !== false,
  };
}

export function formatAgentMetaFooter(meta = {}) {
  if (!meta || (meta.memoryUsed === 0 && !meta.memorySaved && !meta.memoryPending && !meta.skillId && !meta.graphUsed)) {
    return "";
  }
  const parts = [];
  if (meta.memoryUsed > 0) parts.push(`memory used: ${meta.memoryUsed}`);
  if (meta.graphUsed > 0) parts.push(`graph: ${meta.graphUsed}`);
  if (meta.memoryPending) parts.push("memory saving…");
  else if (meta.memorySaved > 0) parts.push(`saved: ${meta.memorySaved}`);
  if (meta.skillId) parts.push(`skill: ${meta.skillId}`);
  if (!parts.length) return "";
  return `\n\n---\n🧠 ${parts.join(" · ")}`;
}

export function finalizeCodeTaskMessage(codeResult) {
  const agentMeta = codeResult?.agentMeta || null;
  const footer = formatAgentMetaFooter(agentMeta);
  return {
    agentMeta,
    content: `${String(codeResult?.message || "").trimEnd()}${footer}`.trimEnd(),
  };
}
