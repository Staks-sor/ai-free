// Продолжение tool-loop: сохраняем skill/memory блоки без полного system prompt.

export function buildContinuationPrompt({
  skillId = null,
  skillPrompt = null,
  memoryContext = "",
  tool,
  toolResult,
  clarifications = "",
  browserOnly = false,
} = {}) {
  const parts = [];

  if (skillPrompt) {
    parts.push(`=== ACTIVE SKILL: ${skillId} ===\n${skillPrompt}\n=== END SKILL ===`);
  }

  const memory = String(memoryContext || "").trim();
  if (memory) {
    parts.push(`=== MEMORY ===\n${memory}\n=== END MEMORY ===`);
  }

  parts.push(`Tool result for ${tool}:\n${JSON.stringify(toolResult, null, 2)}`);

  if (clarifications) {
    parts.push(clarifications);
  }

  const nextStep = browserOnly
    ? "Continue the browser task. Request one browser tool as JSON, or call finish."
    : "Continue the task. If more file access is needed, request one tool call as JSON. If finished, call finish.";
  parts.push(nextStep);
  return parts.join("\n\n");
}

export function buildNoToolCorrectionPrompt(workspaceRoot, task, previousText, { browserOnly = false } = {}) {
  const browserTask = browserOnly || /(найди|найти|поиск|search|открой|нажми|кликн|browser|google|cookie|consent|accept|принять)/iu.test(String(task || ""));
  const browserHint = browserTask
    ? "Start with browser_snapshot, then browser_navigate if needed, browser_click/browser_type by ref (e1, e2…), browser_scroll/browser_wait as needed. Never claim web actions without tool results."
    : "output exactly one JSON tool call to start executing the task.";
  return `No tool call has been executed yet. You claimed progress without using workspace tools.
Task: ${task}
Workspace: ${workspaceRoot}
Your previous text-only response:
${previousText}

Fix this now: ${browserHint}`;
}

export function shouldRejectTextOnlyCodeResult(task, text, toolLogs = []) {
  if (toolLogs.length > 0) return false;

  const answer = String(text || "").trim();
  if (!answer) return false;

  const taskText = String(task || "").trim();
  const answerLower = answer.toLowerCase();

  if (/^(как|что|почему|зачем|объясни|расскажи|покажи пример|explain|what|why|how|tell me)\b/iu.test(taskText)) {
    return false;
  }

  if (/environment mismatch|workspace files are not accessible/i.test(answer)) return true;
  if (/не могу гарантировать|cannot guarantee|may not reach|не доход/i.test(answerLower)) return true;
  if (/могу сделать.*скажи|tell me if you want|ready to proceed|i can do it|готов приступ/i.test(answerLower)) {
    return true;
  }

  const browserTask = /(найди|найти|поиск|search|открой|нажми|кликн|browser|google|гугл|сайт|страниц|узнай|собери|загугли|cookie|consent|accept|принять)/iu.test(taskText);
  if (browserTask && toolLogs.length === 0) {
    const claimsWebAction = /(выполнил|искал|search|нашёл|found|results|результат|открыл|clicked|перешёл|провёл поиск|here are|вот результаты)/iu.test(answerLower);
    if (claimsWebAction) return true;
  }

  const actionTask = /(create|make|fix|edit|update|write|build|implement|создай|сделай|исправ|добав|удали|измен|напиш|реализ|почини|обнов)/iu.test(taskText);
  if (!actionTask) return false;

  const claimsDone = /(готово|создал|сделал|исправил|updated|created|done|finished|готов|добавил|удалил|fixed)/iu.test(answerLower);
  const hasToolMention = /(write_file|run_command|run_shell|"tool")/i.test(answer);
  return claimsDone || !hasToolMention;
}
