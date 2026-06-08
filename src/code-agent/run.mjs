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
  let prompt = createCodeSystemPrompt(workspaceRoot, task, options.systemPrompt);
  let parent = parentMessageId;
  const toolLogs = [];
  const maxToolSteps = resolveMaxToolSteps(options.maxToolSteps);
  const maxTransientTextRetries = resolveTransientTextRetries(options.transientTextRetries);

  for (let step = 0; step < maxToolSteps; step += 1) {
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
        options.onAssistant?.(result.text);
        return { parentMessageId: parent, message: result.text, toolLogs };
      }
      parent = nextParent;

      let toolResult;
      try {
        toolResult = await executeWorkspaceTool(workspaceRoot, call);
      } catch (error) {
        toolResult = { ok: false, error: error.message, fatal: error.fatal === true };
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

      prompt = `Tool result for ${call.tool}:
${JSON.stringify(toolResult, null, 2)}

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

export function isTransientUpstreamTextError(text) {
  return /allocated quota exceeded|quota\/token-limit|token-limit|too many requests|rate limit/i.test(String(text || ""));
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

  if (call.tool !== "run_command") return header;

  const lines = [
    header,
  ];
  if (result.status !== undefined) {
    lines.push(`status: ${result.status}${result.timedOut ? " (timed out)" : ""}`);
  } else if (result.error) {
    lines.push(`error: ${result.error}`);
  }
  if (result.installRequest) {
    lines.push(`install request: ${result.installRequest.title}`);
  }

  if (result.stdout) lines.push(`stdout:\n${result.stdout.trimEnd()}`);
  if (result.stderr) lines.push(`stderr:\n${result.stderr.trimEnd()}`);
  if (!result.stdout && !result.stderr && !result.error) lines.push("[no output]");

  return lines.join("\n");
}
