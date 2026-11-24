import { buildConversationContext } from "../harness/handoff.mjs";
import { normalizeRoleId } from "../agent-runtime/roles.mjs";
// Хелперы для запуска code-agent из window-app server.

import { resolveAgentTaskInput } from "../code-agent/task-input.mjs";
import { RESUMABLE_TASK_STATUSES } from "../harness/task-state.mjs";

export const AGENT_TASK_EMPTY_HELP =
  "Напиши задачу после /code или /skill <id>. Примеры:\n" +
  "• /code создай файл notes.txt\n" +
  "• /skill bug-fix исправь падение при старте\n" +
  "• /skill code-review проверь src/code-agent/";

export function getDeepSeekResumeCheckpoint(conversation, prompt) {
  return conversation?.deepseekCheckpoint
    && /^(?:продолжи(?:ть)?|continue|resume)[.!\s]*$/i.test(String(prompt || "").trim())
    ? conversation.deepseekCheckpoint
    : null;
}

const PERSISTENT_CODE_CONTEXT_PROVIDERS = new Set(["chatgpt", "qwen", "deepseek", "codex", "googleai", "glm"]);
const CONVERSATIONAL_ONLY_RE = /^(?:привет|здравствуй(?:те)?|спасибо|благодарю|круто|отлично|супер|понятно|ясно|ок(?:ей)?|хорошо|молодец|как дела|кто ты|что ты за модель|hello|hi|thanks|thank you|cool|great|awesome|okay|ok|who are you|what model are you)[\s!?.]*$/iu;

export function getCodeSessionId(conversation) {
  return typeof conversation?.codeSessionId === "string" && conversation.codeSessionId
    ? conversation.codeSessionId
    : null;
}

export function setCodeSessionId(conversation, sessionId) {
  if (conversation && typeof sessionId === "string" && sessionId) {
    conversation.codeSessionId = sessionId;
  }
  return getCodeSessionId(conversation);
}

export function migrateLegacyCodeSession(conversation) {
  if (!["deepseek", "qwen", "chatgpt", "googleai"].includes(conversation?.provider || "deepseek")) return;
  if (conversation.provider === "googleai" && conversation.sessionId) {
    try {
      const query = new URL(conversation.sessionId).searchParams.get("q") || "";
      if (query.includes("LOCAL WORKSPACE TOOLS")) {
        conversation.codeSessionId ||= conversation.sessionId;
        conversation.sessionId = null;
        conversation.parentMessageId = null;
        return;
      }
    } catch {}
  }
  if (!conversation.codeParentMessageId || conversation.codeSessionId) return;
  if (conversation.sessionId) {
    conversation.codeSessionId = conversation.sessionId;
    conversation.sessionId = null;
    conversation.parentMessageId = null;
    if (conversation.provider === "qwen") {
      conversation.qwenCodeAccountId = conversation.qwenAccountId || null;
      conversation.qwenAccountId = null;
    }
  }
}

export function resolveConversationAgentTask(prompt, conversation, {
  autoCodeMode = false,
  autoBrowserMode = false,
} = {}) {
  if (conversation.interactionMode === "discuss" && !/^\/(?:code|skill|browser)(?:\s|$)/iu.test(String(prompt || "").trim())) return { run: false, browserOnly: false };
  const harnessTask = conversation.harnessTask;
  if (/^(?:продолжи(?:ть)?|continue|resume)[.!\s]*$/iu.test(String(prompt || "").trim())
    && harnessTask?.checkpoint && RESUMABLE_TASK_STATUSES.has(harnessTask.status)) {
    return { run: true, task: harnessTask.goal, empty: false, browserOnly: harnessTask.browserOnly === true, harnessResume: true };
  }
  const input = resolveAgentTaskInput(prompt, {
    skillId: conversation.skillId || null,
    coderMode: conversation.coderMode === true,
    hardwareMode: conversation.hardwareMode === true,
    autoCodeMode,
    autoBrowserMode,
  });
  if (input.run && conversation.coderMode !== true && !input.slash && CONVERSATIONAL_ONLY_RE.test(String(prompt || "").trim())) {
    return { run: false, browserOnly: false };
  }
  return input;
}

export function buildAgentTaskOptions(conversation, body, { hardwareMode, systemPrompt, agentInput }) {
  const skillId = agentInput?.skillId || conversation.skillId || body.skillId || null;
  return {
    systemPrompt: [systemPrompt, buildConversationContext(conversation)].filter(Boolean).join("\n\n"),
    ...(Array.isArray(body.images) && body.images.length ? { images: body.images } : {}),
    roleId: normalizeRoleId(conversation.roleId),
    harnessResume: agentInput?.harnessResume === true,
    skillId,
    browserOnly: agentInput?.browserOnly === true,
    accessMode: conversation?.accessMode === "computer" ? "computer" : "project",
    memoryEnabled: conversation.memoryEnabled !== false && body.memoryEnabled !== false,
    autoSkill: !skillId && conversation.autoSkill !== false && body.autoSkill !== false,
    compactInitialPrompt: ["googleai", "glm"].includes(conversation.provider)
      || (PERSISTENT_CODE_CONTEXT_PROVIDERS.has(conversation.provider)
        && Boolean(conversation.codeParentMessageId)),
    compactContextMaxChars: ["googleai", "glm"].includes(conversation.provider) ? 600 : null,
    compactContinuationMemoryChars: ["googleai", "glm"].includes(conversation.provider) ? 150 : null,
    compactContinuationToolResultChars: ["googleai", "glm"].includes(conversation.provider) ? 600 : null,
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
