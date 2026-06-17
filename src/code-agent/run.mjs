// Главная петля /code-агента. Шлёт system prompt → парсит ответ → если это tool-call,
// исполняет → формирует следующий prompt с результатом → повторяет до finish.
// Лимит шагов защищает от бесконечных циклов модели, но должен быть достаточным
// для больших задач с несколькими файлами.

import { createCodeSystemPrompt } from "./prompt.mjs";
import { parseToolCall } from "./parser.mjs";
import { executeWorkspaceTool } from "./executor.mjs";

export async function runCodeTask(
  client,
  baseOptions,
  workspaceRoot,
  task,
  parentMessageId = null,
  options = {},
) {
  let prompt = createCodeSystemPrompt(workspaceRoot, task, options.systemPrompt, {
    searchEnabled: baseOptions?.searchEnabled === true,
  });
  let parent = parentMessageId;
  const toolLogs = [];
  const maxToolSteps = resolveMaxToolSteps(options.maxToolSteps);
  const maxTransientTextRetries = resolveTransientTextRetries(options.transientTextRetries);
  const maxNoToolTextRetries = resolveNoToolTextRetries(options.noToolTextRetries);
  let noToolTextRetries = 0;

  for (let step = 0; step < maxToolSteps; step += 1) {
    if (options.signal?.aborted) {
      const message = "⏹ Остановлено пользователем.";
      options.onAssistant?.(message);
      return { parentMessageId: parent, message, toolLogs, stopped: true };
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
          transientTextRetries < maxTransientTextRetries
          && isTransientUpstreamTextError(result.text)
        ) {
          transientTextRetries += 1;
          await sleep(750 * transientTextRetries);
          continue;
        }
        parent = nextParent;
        if (shouldRejectTextOnlyCodeResult(task, result.text, toolLogs)) {
          if (noToolTextRetries >= maxNoToolTextRetries) {
            const message = "Error: the model answered without using workspace tools, so no file changes were made. Retry the task or switch provider.";
            options.onAssistant?.(message);
            return { parentMessageId: parent, message, toolLogs };
          }
          noToolTextRetries += 1;
          prompt = buildNoToolCorrectionPrompt(workspaceRoot, task, result.text);
          continue;
        }
        options.onAssistant?.(result.text);
        return { parentMessageId: parent, message: result.text, toolLogs };
      }
      parent = nextParent;

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
        return { parentMessageId: parent, message: toolResult.message, toolLogs };
      }

      if (toolResult.awaitingUser) {
        const message = `Нужно уточнение: ${toolResult.userQuestion?.question || "ответ пользователя"}`;
        options.onAssistant?.(message);
        return { parentMessageId: parent, message, toolLogs, awaitingUser: true };
      }

      if (toolResult.fatal) {
        const message = `Error: ${toolResult.error}`;
        options.onAssistant?.(message);
        return { parentMessageId: parent, message, toolLogs };
      }

      const clarifications = typeof options.takeInterrupts === "function"
        ? options.takeInterrupts()
        : [];
      const clarificationText = Array.isArray(clarifications) && clarifications.length
        ? `\n\nImportant user clarification received while you were working:\n${clarifications
          .map((item, index) => `${index + 1}. ${item}`)
          .join("\n")}\nUpdate your plan and next action to follow this clarification.`
        : "";

      prompt = `Tool result for ${call.tool}:
${JSON.stringify(toolResult, null, 2)}
${clarificationText}

Continue the task. If more file access is needed, request one tool call as JSON. If finished, call finish.`;
      break;
    }
  }

  const message = `Error: /code reached the tool-step limit (${maxToolSteps}). Split the task into smaller parts or increase DSCLI_CODE_MAX_STEPS.`;
  options.onAssistant?.(message);
  return { parentMessageId: parent, message, toolLogs };
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

export function shouldRejectTextOnlyCodeResult(task, text, toolLogs = []) {
  if (Array.isArray(toolLogs) && toolLogs.length > 0) return false;
  const taskText = String(task || "").toLowerCase();
  const answer = String(text || "").toLowerCase();
  const taskRequiresWorkspace =
    /\b(create|make|add|edit|update|change|fix|repair|remove|delete|rename|implement|write|modify|install|run|test|verify|check|build|refactor)\b/i.test(taskText)
    || /(созда|сдела|добав|измени|обнов|исправ|почини|удали|переимен|реализ|напиш|установ|запусти|проверь|собери|рефактор)/i.test(taskText);
  const answerClaimsWork =
    /\b(created|made|added|edited|updated|changed|fixed|removed|deleted|renamed|implemented|wrote|modified|installed|ran|tested|verified|built|done|completed)\b/i.test(answer)
    || /(создал|сделал|добавил|изменил|обновил|исправил|починил|удалил|переименовал|реализовал|написал|установил|запустил|проверил|собрал|готово|выполнено)/i.test(answer);
  const answerRefusesWorkspace =
    /environment mismatch|workspace files are not accessible|runtime is not mounted|re-run inside|cannot proceed|не вижу.*workspace|не доступ/i.test(answer);
  return taskRequiresWorkspace || answerClaimsWork || answerRefusesWorkspace;
}

function buildNoToolCorrectionPrompt(workspaceRoot, task, previousText) {
  return `Your previous response was plain text, but this code-agent task requires workspace tools.
No tool call has been executed yet, so no file changes have been made.

Workspace root is mounted and available to the local tool runtime:
${workspaceRoot}

User task:
${task}

Previous plain-text response to correct:
${String(previousText || "").slice(0, 2000)}

Reply with exactly one JSON tool call and no prose.
Start with list_files/read_file if you need context, or use write_file/mkdir/run_command/run_shell as appropriate.
If the task truly needs no workspace action, call {"tool":"finish","message":"No changes made: ..."}.
Do not claim that you created, changed, checked, or ran anything until a tool result confirms it.`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatToolLog(call, result) {
  const target = call.path || call.cmd || "";
  const header = `[tool] ${call.tool} ${target}`.trim();

  if (call.tool === "list_files") {
    const lines = [header];
    if (result.error) {
      lines.push(`error: ${result.error}`);
      return lines.join("\n");
    }
    const entries = Array.isArray(result.entries) ? result.entries : [];
    lines.push(`entries: ${entries.length}${result.truncated ? " (truncated)" : ""}`);
    if (entries.length) {
      lines.push(entries.slice(0, 80).join("\n"));
      if (entries.length > 80) lines.push(`[${entries.length - 80} more omitted from log]`);
    } else {
      lines.push("[empty]");
    }
    return lines.join("\n");
  }

  if (call.tool === "list_serial_ports") {
    const lines = [header];
    if (result.error) {
      lines.push(`error: ${result.error}`);
      return lines.join("\n");
    }
    const ports = Array.isArray(result.ports) ? result.ports : [];
    lines.push(`ports: ${ports.length}`);
    if (ports.length) {
      lines.push(ports.join("\n"));
    } else {
      lines.push("[none]");
    }
    return lines.join("\n");
  }

  if (call.tool === "ask_user") {
    const lines = [header];
    if (result.error) lines.push(`error: ${result.error}`);
    if (result.userQuestion?.question) lines.push(result.userQuestion.question);
    return lines.join("\n");
  }

  if (call.tool !== "run_command" && call.tool !== "run_shell") return header;

  const lines = [
    header,
  ];
  if (call.tool === "run_shell" && call.command) {
    lines.push(`command: ${call.command}`);
  }
  if (result.status !== undefined) {
    lines.push(`status: ${result.status}${result.timedOut ? " (timed out)" : ""}`);
  } else if (result.error) {
    lines.push(`error: ${result.error}`);
  }
  if (result.installRequest) {
    lines.push(`install request: ${result.installRequest.title}`);
  }
  if (result.permissionRequest) {
    lines.push(`permission request: ${result.permissionRequest.title}`);
  }

  if (result.stdout) lines.push(`stdout:\n${result.stdout.trimEnd()}`);
  if (result.stderr) lines.push(`stderr:\n${result.stderr.trimEnd()}`);
  if (!result.stdout && !result.stderr && !result.error) lines.push("[no output]");

  return lines.join("\n");
}
