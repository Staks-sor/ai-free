// Главная петля /code-агента. Шлёт system prompt → tool loop → execution → memory.

import { createCodeSystemPrompt } from "./prompt.mjs";
import { createBrowserSystemPrompt } from "./browser-prompt.mjs";
import { parseToolCall } from "./parser.mjs";
import { executeWorkspaceTool } from "./executor.mjs";
import { enqueueCodeExperienceSave } from "../memory/async-queue.mjs";
import { isToolAllowed } from "../skills/permissions.mjs";
import { formatToolLog } from "./tool-log.mjs";
import {
  buildContinuationPrompt,
  buildNoToolCorrectionPrompt,
  shouldRejectTextOnlyCodeResult,
} from "./loop-helpers.mjs";

export async function runCodeTask(
  client,
  baseOptions,
  workspaceRoot,
  task,
  parentMessageId = null,
  options = {},
) {
  const browserOnly = options.browserOnly === true;
  const skillId = options.skillId || null;
  const skillPrompt = options.skillPrompt || null;
  const memoryContext = options.memoryContext || "";
  const browserContext = options.browserContext || "";
  const allowedTools = options.allowedTools || null;

  let prompt = browserOnly
    ? createBrowserSystemPrompt(task, { browserContext })
    : createCodeSystemPrompt(workspaceRoot, task, options.systemPrompt, {
        searchEnabled: baseOptions?.searchEnabled === true,
        skillId,
        skillPrompt,
        memoryContext,
        browserContext,
        allowedTools,
      });

  let parent = parentMessageId;
  const toolLogs = [];
  const maxToolSteps = resolveMaxToolSteps(options.maxToolSteps);
  const maxTransientRetries = resolveTransientTextRetries(options.transientTextRetries);
  const maxNoToolRetries = resolveNoToolTextRetries(options.noToolTextRetries);
  let noToolRetries = 0;

  const memoryUsedCount = Number(options.memoryUsedCount) || 0;
  const graphUsedCount = Number(options.graphUsedCount) || 0;
  const finish = (payload) => completeRunResult(payload, {
    task,
    toolLogs,
    workspaceRoot,
    memoryEnabled: options.memoryEnabled,
    memoryUsedCount,
    graphUsedCount,
    skillId,
    onMemorySaved: options.onMemorySaved,
    browserOnly,
  });

  for (let step = 0; step < maxToolSteps; step += 1) {
    if (options.signal?.aborted) {
      const message = "⏹ Остановлено пользователем.";
      options.onAssistant?.(message);
      return finish({ parentMessageId: parent, message, toolLogs, stopped: true });
    }

    let transientTextRetries = 0;

    for (;;) {
      const result = await client.complete({
        ...baseOptions,
        prompt,
        parentMessageId: parent,
      });
      const nextParent = result.lastAssistantMessageId ?? parent;
      const call = parseToolCall(result.text);

      if (!call) {
        if (
          transientTextRetries < maxTransientRetries
          && isTransientUpstreamTextError(result.text)
        ) {
          transientTextRetries += 1;
          await sleep(750 * transientTextRetries);
          continue;
        }

        parent = nextParent;

        if (shouldRejectTextOnlyCodeResult(task, result.text, toolLogs)) {
          if (noToolRetries >= maxNoToolRetries) {
            const message = "Error: model keeps responding without using workspace tools.";
            options.onAssistant?.(message);
            return finish({ parentMessageId: parent, message, toolLogs });
          }
          noToolRetries += 1;
          prompt = buildNoToolCorrectionPrompt(workspaceRoot, task, result.text, { browserOnly });
          continue;
        }

        options.onAssistant?.(result.text);
        return finish({ parentMessageId: parent, message: result.text, toolLogs });
      }

      parent = nextParent;

      if (!isToolAllowed(call.tool, allowedTools)) {
        const blocked = {
          ok: false,
          error: `Tool "${call.tool}" is not allowed by the active skill.`,
          fatal: false,
        };
        const log = formatToolLog(call, blocked);
        toolLogs.push(log);
        options.onTool?.(call, blocked, log);
        prompt = buildContinuationPrompt({
          skillId,
          skillPrompt,
          memoryContext,
          tool: call.tool,
          toolResult: blocked,
          browserOnly,
        });
        break;
      }

      let toolResult;
      try {
        toolResult = await executeWorkspaceTool(workspaceRoot, call);
      } catch (error) {
        toolResult = {
          ok: false,
          error: error.message,
          fatal: error.fatal === true,
          permissionRequest: error.permissionRequest || null,
        };
      }

      const log = formatToolLog(call, toolResult);
      if (!toolResult.done) {
        toolLogs.push(log);
        options.onTool?.(call, toolResult, log);
      }

      if (toolResult.done) {
        options.onAssistant?.(toolResult.message);
        return finish({ parentMessageId: parent, message: toolResult.message, toolLogs });
      }

      if (toolResult.awaitingUser) {
        const message = `Нужно уточнение: ${toolResult.userQuestion?.question || "ответ пользователя"}`;
        options.onAssistant?.(message);
        return finish({ parentMessageId: parent, message, toolLogs, awaitingUser: true });
      }

      if (toolResult.fatal) {
        const message = `Error: ${toolResult.error}`;
        options.onAssistant?.(message);
        return finish({ parentMessageId: parent, message, toolLogs });
      }

      const clarifications = typeof options.takeInterrupts === "function"
        ? options.takeInterrupts()
        : [];
      const clarificationText = Array.isArray(clarifications) && clarifications.length
        ? `\n\nImportant user clarification received while you were working:\n${clarifications
          .map((item, index) => `${index + 1}. ${item}`)
          .join("\n")}\nUpdate your plan and next action to follow this clarification.`
        : "";

      prompt = buildContinuationPrompt({
        skillId,
        skillPrompt,
        memoryContext,
        tool: call.tool,
        toolResult,
        clarifications: clarificationText,
        browserOnly,
      });
      break;
    }
  }

  const message = `Error: /code reached the tool-step limit (${maxToolSteps}). Split the task into smaller parts or increase DSCLI_CODE_MAX_STEPS.`;
  options.onAssistant?.(message);
  return finish({ parentMessageId: parent, message, toolLogs });
}

function completeRunResult(payload, {
  task,
  toolLogs,
  workspaceRoot,
  memoryEnabled,
  memoryUsedCount,
  graphUsedCount,
  skillId,
  onMemorySaved,
  browserOnly = false,
}) {
  let memoryPending = false;
  if (memoryEnabled !== false && !browserOnly) {
    memoryPending = enqueueCodeExperienceSave({
      task,
      toolLogs,
      workspaceRoot,
      onComplete: onMemorySaved,
    });
  }

  return {
    ...payload,
    agentMeta: {
      skillId: skillId || null,
      memoryUsed: memoryEnabled === false ? 0 : memoryUsedCount,
      graphUsed: memoryEnabled === false ? 0 : graphUsedCount,
      memorySaved: 0,
      memoryPending: memoryEnabled !== false && memoryPending,
    },
  };
}

export function resolveMaxToolSteps(value) {
  const raw = value ?? process.env.DSCLI_CODE_MAX_STEPS ?? 200;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 200;
  return Math.min(Math.max(Math.floor(parsed), 5), 200);
}

export function resolveTransientTextRetries(value) {
  const parsed = Number(value ?? process.env.DSCLI_CODE_TRANSIENT_RETRIES ?? 2);
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(Math.max(Math.floor(parsed), 0), 5);
}

export function resolveNoToolTextRetries(value) {
  const parsed = Number(value ?? process.env.DSCLI_CODE_NO_TOOL_RETRIES ?? 2);
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(Math.max(Math.floor(parsed), 0), 5);
}

export function isTransientUpstreamTextError(text) {
  return /allocated quota exceeded|quota\/token-limit|token-limit|too many requests|rate limit/i.test(String(text || ""));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { formatToolLog } from "./tool-log.mjs";
export { shouldRejectTextOnlyCodeResult } from "./loop-helpers.mjs";
