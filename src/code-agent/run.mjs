// Главная петля /code-агента. Шлёт system prompt → tool loop → execution → memory.

import { computerAccessPrompt, hasComputerAccess } from "./access-policy.mjs";
import { prepareComputerScreenshot, cacheComputerImages, readComputerImages, removeComputerImages } from "./computer-images.mjs";
import { createCodeSystemPrompt } from "./prompt.mjs";
import { assertLicensedAccess } from '../licensing/client.mjs';
import { createCompactTaskPrompt } from "./compact-prompt.mjs";
import { collectProjectReviewEvidence } from "./project-review.mjs";
import { loadSettings } from "../state/settings.mjs";
import { createBrowserSystemPrompt } from "./browser-prompt.mjs";
import { parseToolCall } from "./parser.mjs";
import { executeWorkspaceTool } from "./executor.mjs";
import { enqueueCodeExperienceSave } from "../memory/async-queue.mjs";
import { isToolAllowed } from "../skills/permissions.mjs";
import { formatToolLog } from "./tool-log.mjs";
import { createNativeCodeSystemPrompt, NATIVE_CODE_TOOLS } from "./native-tools.mjs";
import {
  buildContinuationPrompt,
  buildNoToolCorrectionPrompt,
  buildProjectAnalysisCorrectionPrompt,
  shouldRejectPrematureProjectAnalysisFinish,
  isProjectAnalysisTask,
  shouldRejectTextOnlyCodeResult,
  shouldRejectPendingCodeWork,
  isWorkspaceToolUnavailableResponse,
  shouldRejectUnexecutedCodeFinish,
} from "./loop-helpers.mjs";
import { createFileLogger, withLogSpan } from "../logging/logger.mjs";
import { measureModelTurn } from "../diagnostics/runtime-metrics.mjs";

const agentLogger = createFileLogger({ component: "code-agent" });
const completeModelWithLogging = withLogSpan(
  agentLogger,
  "agent.model_complete",
  measureModelTurn,
  {
    details: (_client, request) => ({
      model: request?.model || null,
      promptChars: String(request?.prompt || "").length,
      toolCount: Array.isArray(request?.tools) ? request.tools.length : 0,
      hasToolResult: Boolean(request?.toolResult),
    }),
  },
);
const executeToolWithLogging = withLogSpan(
  agentLogger,
  "agent.tool_execute",
  (workspaceRoot, call, executionOptions) => executeWorkspaceTool(workspaceRoot, call, executionOptions),
  {
    details: (_workspaceRoot, call) => ({ tool: call?.tool || "unknown" }),
  },
);

export async function runCodeTask(
  client,
  baseOptions,
  workspaceRoot,
  task,
  parentMessageId = null,
  options = {},
) {
  const accessMode = hasComputerAccess(options) ? "computer" : "project";
  const toolPolicy = { accessMode };
  const browserOnly = options.browserOnly === true;
  const skillId = options.skillId || null;
  const skillPrompt = options.skillPrompt || null;
  const memoryContext = options.memoryContext || "";
  const projectInstructionsContext = options.projectInstructionsContext || "";
  const browserContext = options.browserContext || "";
  const allowedTools = options.allowedTools || null;
  agentLogger.info("agent.task.start", {
    workspaceRoot,
    taskChars: String(task || "").length,
    model: baseOptions?.model || null,
    browserOnly,
    skillId,
    memoryUsedCount: Number(options.memoryUsedCount) || 0,
    graphUsedCount: Number(options.graphUsedCount) || 0,
  });

  const nativeTools = client?.supportsNativeTools === true;
  const nativeSystemPrompt = nativeTools ? [options.systemPrompt, createNativeCodeSystemPrompt(workspaceRoot, {
    accessMode,
    conversationContext: baseOptions?.conversationContext,
    skillPrompt,
    memoryContext,
    projectInstructionsContext,
    browserContext,
  })].filter(Boolean).join("\n\n") : "";
  const availableNativeTools = nativeTools
    ? NATIVE_CODE_TOOLS.filter((tool) => isToolAllowed(tool.function.name, allowedTools, toolPolicy))
    : null;
  const resumeState = options.resumeState && typeof options.resumeState === "object"
    ? options.resumeState
    : null;
  let pendingToolResult = resumeState?.pendingToolResult || null;
  let pendingImagePaths = Array.isArray(resumeState?.pendingImagePaths) ? resumeState.pendingImagePaths : [];
  let pendingImages = pendingImagePaths.length ? readComputerImages(pendingImagePaths)
    : resumeState ? [] : (options.images || baseOptions?.images || []);
  if (pendingImages.length && client.supportsImageAttachments !== true) {
    throw Object.assign(new Error('The selected provider cannot receive image attachments.'), { delivery: 'not_sent' });
  }
  if (pendingImages.length && !pendingImagePaths.length) pendingImagePaths = cacheComputerImages(pendingImages);
  let prompt = resumeState?.prompt ?? (nativeTools
    ? task
    : options.compactInitialPrompt === true
      ? createCompactTaskPrompt(task, {
          memoryContext,
          projectInstructionsContext,
          maxContextChars: options.compactContextMaxChars,
          systemPrompt: options.systemPrompt,
        })
      : browserOnly
      ? createBrowserSystemPrompt(task, { browserContext })
      : createCodeSystemPrompt(workspaceRoot, task, options.systemPrompt, {
          searchEnabled: baseOptions?.searchEnabled === true,
          skillId,
          skillPrompt,
          memoryContext,
          projectInstructionsContext,
          browserContext,
          allowedTools,
          accessMode,
        }));
  if (resumeState?.clarification) {
    const clarification = `User clarification while resuming: ${resumeState.clarification}`;
    prompt = prompt ? `${prompt}\n\n${clarification}` : clarification;
  }

  let parent = resumeState?.parentMessageId ?? parentMessageId;
  const toolLogs = Array.isArray(resumeState?.toolLogs) ? [...resumeState.toolLogs] : [];
  let hasSuccessfulWorkspaceAction = resumeState?.hasSuccessfulWorkspaceAction === true;
  let requiresCodeVerification = resumeState?.requiresCodeVerification === true;
  let codeVerification = resumeState?.codeVerification || 'not_run';
  let verificationCorrections = 0;
  let planCorrections = 0;

  if (options.preloadProjectReview === true && !resumeState && isProjectAnalysisTask(task)) {
    const evidence = await collectProjectReviewEvidence(workspaceRoot);
    if (evidence.files.length >= 3) {
      prompt += `\n\n${evidence.prompt}`;
      for (const { call, result } of evidence.results) {
        const log = formatToolLog(call, result);
        toolLogs.push(log);
        options.onTool?.(call, result, log);
      }
    }
  }
  const maxToolSteps = resolveMaxToolSteps(options.maxToolSteps);
  const maxTransientRetries = resolveTransientTextRetries(options.transientTextRetries);
  const maxNoToolRetries = resolveNoToolTextRetries(
    options.noToolTextRetries ?? client?.noToolTextRetries,
  );
  let noToolRetries = 0;
  let repairingMissingTool = false;

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
  const stopped = () => {
    const message = "⏹ Остановлено пользователем.";
    options.onAssistant?.(message);
    return finish({ parentMessageId: parent, message, toolLogs, stopped: true });
  };

  for (let step = 0; step < maxToolSteps; step += 1) {
    if (options.signal?.aborted) return stopped();

    let transientTextRetries = 0;

    for (;;) {
      if (!nativeTools && (accessMode === "computer" || resumeState?.accessMode === "computer")) {
        const marker = "\n\n=== CURRENT CHAT ACCESS (overrides earlier access policy) ===\n";
        const previous = prompt.lastIndexOf(marker);
        prompt = (previous < 0 ? prompt : prompt.slice(0, previous)) + marker + computerAccessPrompt(toolPolicy);
      }
      const modelCheckpoint = {
        phase: "awaiting_model",
        accessMode, pendingImagePaths,
        task,
        prompt,
        pendingToolResult,
        parentMessageId: parent,
        toolLogs: [...toolLogs], hasSuccessfulWorkspaceAction, requiresCodeVerification, codeVerification,
      };
      await options.onCheckpoint?.(modelCheckpoint);
      if (options.signal?.aborted) return stopped();
      let result;
      try {
        result = await completeModelWithLogging(client, {
          ...baseOptions,
          signal: options.signal,
          ...(repairingMissingTool ? { searchEnabled: false } : {}),
          prompt,
          images: pendingImages,
          parentMessageId: parent,
          ...(nativeTools ? {
            systemPrompt: nativeSystemPrompt,
            tools: availableNativeTools,
            toolResult: pendingToolResult,
          } : {}),
        });
      } catch (error) {
        if (options.signal?.aborted || error.name === "AbortError") {
          if (error.qwenTurn) await options.onCheckpoint?.({ ...modelCheckpoint, qwenTurn: error.qwenTurn });
          return stopped();
        }
        throw error;
      }
      if (options.signal?.aborted) return stopped();
      pendingToolResult = null;
      pendingImages = [];
      removeComputerImages(pendingImagePaths);
      pendingImagePaths = [];
      const nextParent = result.lastAssistantMessageId ?? parent;
      let call = result.toolCall
        ? { tool: result.toolCall.name, ...result.toolCall.arguments }
        : (client.parseToolCall?.(result.text) ?? parseToolCall(result.text));

      // A clarification can arrive while the provider is generating its final
      // answer. Do not accept a stale text response/finish call in that race:
      // feed the clarification back into the same task first.
      if (!call || call.tool === "finish") {
        const lateClarifications = takeInterrupts(options);
        if (lateClarifications.length) {
          parent = nextParent;
          prompt = buildClarificationPrompt(lateClarifications);
          continue;
        }
      }

      const responseText = call?.tool === "finish" ? call.message : result.text;
      if ((!call || call.tool === "finish") && options.isTaskPlanIncomplete?.()) {
        parent = nextParent;
        if (planCorrections >= maxNoToolRetries) {
          const message = "План задачи ещё не завершён. Продолжите оставшиеся шаги.";
          if (nativeTools && result.toolCall?.id) pendingToolResult = { toolCallId: result.toolCall.id,
            result: { ok: false, error: "Task plan is incomplete.", fatal: false } };
          await options.onCheckpoint?.({ phase: "ready", task, prompt, pendingToolResult,
            parentMessageId: parent, toolLogs: [...toolLogs], hasSuccessfulWorkspaceAction, requiresCodeVerification, codeVerification });
          options.onAssistant?.(message);
          return finish({ parentMessageId: parent, message, toolLogs, failed: true });
        }
        planCorrections += 1;
        prompt = "The saved task plan has incomplete steps. Do not finish. Execute the remaining work, verify it, and call update_plan to mark only genuinely completed steps. Request one tool call now.";
        if (nativeTools && result.toolCall?.id) pendingToolResult = { toolCallId: result.toolCall.id,
          result: { ok: false, error: "Task plan is incomplete. Continue remaining steps.", fatal: false } };
        continue;
      }

      if ((!call || call.tool === 'finish') && options.requireVerification === true
        && requiresCodeVerification && codeVerification !== 'passed') {
        parent = nextParent;
        if (verificationCorrections >= maxNoToolRetries) {
          const message = 'Изменения внесены, но проверки не пройдены. Задача требует исправления.';
          if (nativeTools && result.toolCall?.id) pendingToolResult = { toolCallId: result.toolCall.id,
            result: { ok: false, error: "Verification required before finish.", fatal: false } };
          await options.onCheckpoint?.({ phase: "ready", task, prompt, pendingToolResult,
            parentMessageId: parent, toolLogs: [...toolLogs], hasSuccessfulWorkspaceAction, requiresCodeVerification, codeVerification });

          options.onAssistant?.(message);
          return finish({ parentMessageId: parent, message, toolLogs, failed: true });
        }
        verificationCorrections += 1;
        prompt = `Task: ${task}\nCode changes are not verified (${codeVerification}). Do not finish yet. Repair failing checks if needed, then call verify_task with relevant checks for the requested result. If execution needs permission, request it through the existing tools. Do not claim success without passing checks after the last edit.`;
        if (nativeTools && result.toolCall?.id) {
          pendingToolResult = { toolCallId: result.toolCall.id,
            result: { ok: false, error: 'Verification required before finish.', fatal: false } };
        }
        continue;
      }

      // A real, read-only result can repair a remote model's mistaken belief
      // that the external executor is unavailable. Never synthesize a write.
      if ((!call || call.tool === "finish") && !nativeTools && !browserOnly
        && toolLogs.length === 0 && isToolAllowed("list_files", allowedTools, toolPolicy)
        && isWorkspaceToolUnavailableResponse(responseText)
        && shouldRejectTextOnlyCodeResult(task, responseText, toolLogs)) {
        agentLogger.info("agent.workspace_probe", { reason: "model_reported_tools_unavailable" });
        call = { tool: "list_files", path: ".", maxDepth: 1, maxEntries: 100 };
      }

      const pendingFinish = call?.tool === "finish" && (
        shouldRejectPendingCodeWork(task, call.message)
        || isWorkspaceToolUnavailableResponse(call.message)
        || shouldRejectUnexecutedCodeFinish(task, call.message, hasSuccessfulWorkspaceAction)
      );
      if (!call || pendingFinish) {
        const responseText = pendingFinish ? call.message : result.text;
        if (
          !call &&
          transientTextRetries < maxTransientRetries
          && isTransientUpstreamTextError(result.text)
        ) {
          transientTextRetries += 1;
          await sleep(750 * transientTextRetries);
          continue;
        }

        parent = nextParent;

        if (!call && shouldRejectPrematureProjectAnalysisFinish(task, result.text, toolLogs)) {
          repairingMissingTool = true;
          prompt = buildProjectAnalysisCorrectionPrompt(task, result.text, toolLogs);
          break;
        }

        if (pendingFinish || shouldRejectTextOnlyCodeResult(task, responseText, toolLogs, hasSuccessfulWorkspaceAction)) {
          if (noToolRetries >= maxNoToolRetries) {
            const message = "Error: model keeps responding without using workspace tools.";
            options.onAssistant?.(message);
            return finish({ parentMessageId: parent, message, toolLogs, failed: true });
          }
          noToolRetries += 1;
          repairingMissingTool = true;
          prompt = buildNoToolCorrectionPrompt(workspaceRoot, task, responseText, {
            browserOnly,
            hasToolHistory: toolLogs.length > 0,
          });
          if (pendingFinish && nativeTools && result.toolCall?.id) {
            pendingToolResult = {
              toolCallId: result.toolCall.id,
              result: { ok: false, error: "Implementation is pending; continue with the next workspace tool.", fatal: false },
            };
          }
          continue;
        }

        options.onAssistant?.(result.text);
        return finish({ parentMessageId: parent, message: result.text, toolLogs });
      }

      parent = nextParent;
      repairingMissingTool = false;
      noToolRetries = 0;

      if (
        call.tool === "finish"
        && shouldRejectPrematureProjectAnalysisFinish(task, call.message, toolLogs)
      ) {
        prompt = buildProjectAnalysisCorrectionPrompt(task, call.message, toolLogs);
        if (nativeTools && result.toolCall?.id) {
          pendingToolResult = {
            toolCallId: result.toolCall.id,
            result: { ok: false, error: "Project analysis is incomplete; inspect more evidence.", fatal: false },
          };
        }
        break;
      }

      if (!isToolAllowed(call.tool, allowedTools, toolPolicy)) {
        const blocked = {
          ok: false,
          error: `Tool "${call.tool}" is not allowed by the active skill.`,
          fatal: false,
        };
        const log = formatToolLog(call, blocked);
        toolLogs.push(log);
        options.onTool?.(call, blocked, log);
        if (nativeTools && result.toolCall?.id) {
          pendingToolResult = { toolCallId: result.toolCall.id, result: blocked };
          prompt = "";
        } else prompt = buildContinuationPrompt({
          skillId,
          skillPrompt,
          memoryContext,
          memoryContextMaxChars: options.compactContinuationMemoryChars,
          tool: call.tool,
          toolResult: blocked,
          toolResultMaxChars: options.compactContinuationToolResultChars,
          browserOnly,
        });
        break;
      }

      let toolResult;
      await assertLicensedAccess();
      await options.onCheckpoint?.({
        phase: "executing_tool", task, prompt, pendingToolResult,
        parentMessageId: parent, toolLogs: [...toolLogs], hasSuccessfulWorkspaceAction, requiresCodeVerification, codeVerification, pendingAction: call,
      });
      if (options.signal?.aborted) return stopped();
      try {
        const commandPermissions = {
          ...(loadSettings().commandPermissions || {}),
          ...(options.executionPermissions || {}),
        };
        toolResult = await executeToolWithLogging(workspaceRoot, call, {
          workspaceRoot,
          accessMode,
          signal: options.signal,
          allowDestructiveActions: commandPermissions.allowDestructiveActions === true,
          allowExternalWrites: commandPermissions.allowExternalWrites === true,
        });
      } catch (error) {
        if (options.signal?.aborted || error.name === "AbortError") return stopped();
        toolResult = {
          ok: false,
          error: error.message,
          fatal: error.fatal === true,
          permissionRequest: error.permissionRequest || null,
        };
      }

      const screenshot = prepareComputerScreenshot(toolResult, client.supportsImageAttachments);
      toolResult = screenshot.result;
      pendingImages = screenshot.images;
      pendingImagePaths = cacheComputerImages(pendingImages);

      const successful = toolResult.ok !== false && !toolResult.error;
      if (successful && ['write_file', 'append_file', 'delete_file', 'delete_dir', 'mkdir'].includes(call.tool)) {
        requiresCodeVerification = true;
      }
      if (['run_command', 'run_shell'].includes(call.tool) && Object.hasOwn(toolResult, 'status')) {
        requiresCodeVerification = true;
      }
      if (['write_file', 'append_file', 'delete_file', 'delete_dir', 'mkdir', 'run_command', 'run_shell'].includes(call.tool)) {
        codeVerification = 'not_run';
      } else if (call.tool === 'verify_task') {
        codeVerification = toolResult.verification || 'failed';
      }
      const log = formatToolLog(call, toolResult);
      if (toolResult.ok !== false && !toolResult.error && (
        ["write_file", "append_file", "mkdir", "delete_file", "delete_dir"].includes(call.tool)
        || (["run_command", "run_shell"].includes(call.tool) && toolResult.status === 0)
        || (call.tool === "verify_task" && toolResult.verification === "passed")
      )) hasSuccessfulWorkspaceAction = true;
      if (!toolResult.done) {
        toolLogs.push(log);
        options.onTool?.(call, toolResult, log);
      }

      if (toolResult.done) {
        options.onAssistant?.(toolResult.message);
        return finish({ parentMessageId: parent, message: toolResult.message, toolLogs });
      }

      if (toolResult.awaitingUser || toolResult.fatal) {
        const continuation = nativeTools && result.toolCall?.id
          ? { prompt: "", pendingToolResult: { toolCallId: result.toolCall.id, result: toolResult } }
          : { prompt: buildContinuationPrompt({ tool: call.tool, toolResult }), pendingToolResult: null };
        await options.onCheckpoint?.({ phase: "ready", accessMode, pendingImagePaths, task, ...continuation,
          parentMessageId: parent, toolLogs: [...toolLogs], hasSuccessfulWorkspaceAction, requiresCodeVerification, codeVerification });
      }

      if (toolResult.awaitingUser) {
        const message = `Нужно уточнение: ${toolResult.userQuestion?.question || "ответ пользователя"}`;
        options.onAssistant?.(message);
        return finish({ parentMessageId: parent, message, toolLogs, awaitingUser: true });
      }

      if (toolResult.fatal) {
        const message = `Error: ${toolResult.error}`;
        options.onAssistant?.(message);
        return finish({ parentMessageId: parent, message, toolLogs, failed: true });
      }

      const clarifications = takeInterrupts(options);
      const clarificationText = clarifications.length
        ? `\n\n${buildClarificationPrompt(clarifications)}`
        : "";

      if (nativeTools && result.toolCall?.id) {
        pendingToolResult = { toolCallId: result.toolCall.id, result: toolResult };
        prompt = clarificationText ? `User clarification:\n${clarificationText}` : "";
      } else prompt = buildContinuationPrompt({
        skillId,
        skillPrompt,
        memoryContext,
        memoryContextMaxChars: options.compactContinuationMemoryChars,
        tool: call.tool,
        toolResult,
        toolResultMaxChars: options.compactContinuationToolResultChars,
        clarifications: clarificationText,
        browserOnly,
      });
      await options.onCheckpoint?.({
        phase: "ready", accessMode, pendingImagePaths, task, prompt, pendingToolResult,
        parentMessageId: parent, toolLogs: [...toolLogs], hasSuccessfulWorkspaceAction, requiresCodeVerification, codeVerification,
      });
      break;
    }
  }

  const message = `Error: /code reached the tool-step limit (${maxToolSteps}). Split the task into smaller parts or increase DSCLI_CODE_MAX_STEPS.`;
  options.onAssistant?.(message);
  return finish({ parentMessageId: parent, message, toolLogs, failed: true });
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

function takeInterrupts(options) {
  if (typeof options.takeInterrupts !== "function") return [];
  const items = options.takeInterrupts();
  return Array.isArray(items) ? items.filter((item) => String(item || "").trim()) : [];
}

function buildClarificationPrompt(clarifications) {
  return `Important user clarification received while you were working:
${clarifications
    .map((item, index) => `${index + 1}. ${item}`)
    .join("\n")}
Update your plan and next action to follow this clarification.`;
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
