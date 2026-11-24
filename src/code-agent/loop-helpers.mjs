// Продолжение tool-loop: сохраняем skill/memory блоки без полного system prompt.

import { truncateCompactContext } from "./compact-prompt.mjs";

export function buildContinuationPrompt({
  skillId = null,
  skillPrompt = null,
  memoryContext = "",
  memoryContextMaxChars = null,
  tool,
  toolResult,
  toolResultMaxChars = null,
  clarifications = "",
  browserOnly = false,
} = {}) {
  const parts = [];

  if (skillPrompt) {
    parts.push(`=== ACTIVE SKILL: ${skillId} ===\n${skillPrompt}\n=== END SKILL ===`);
  }

  const rawMemory = String(memoryContext || "").trim();
  const memory = memoryContextMaxChars
    ? truncateCompactContext(rawMemory, memoryContextMaxChars)
    : rawMemory;
  if (memory) {
    parts.push(`=== MEMORY ===\n${memory}\n=== END MEMORY ===`);
  }

  const serializedToolResult = JSON.stringify(toolResult, null, 2);
  parts.push(`Tool result for ${tool}:\n${truncateMiddle(
    serializedToolResult,
    toolResultMaxChars,
    "\n...[tool result truncated]...\n",
  )}`);

  if (clarifications) {
    parts.push(clarifications);
  }

  const nextStep = browserOnly
    ? "Continue the browser task. Request one browser tool as JSON, or call finish."
    : [
        "Continue the task. If more file access is needed, request one tool call as JSON. If finished, call finish.",
        "If a write reports no changes, the requested content is already present: do not repeat the same write; verify the next requirement or finish.",
        "If a tool validation fails, correct every missing required argument and do not repeat the identical invalid call.",
        "When a workspace tool can perform the requested action, use it now; do not tell the user to edit files manually.",
      ].join(" ");
  parts.push(nextStep);
  return parts.join("\n\n");
}

function truncateMiddle(value, maxChars, marker) {
  const limit = Number(maxChars);
  if (!Number.isFinite(limit) || limit <= 0 || value.length <= limit) return value;
  const safeLimit = Math.floor(limit);
  if (safeLimit <= marker.length) return marker.slice(0, safeLimit);
  const available = safeLimit - marker.length;
  const headLength = Math.ceil(available / 2);
  return `${value.slice(0, headLength)}${marker}${value.slice(-(available - headLength))}`;
}

export function buildNoToolCorrectionPrompt(workspaceRoot, task, previousText, {
  browserOnly = false,
  hasToolHistory = false,
} = {}) {
  if (hasToolHistory && !browserOnly) {
    const previous = String(previousText || "").trim().slice(0, 1200);
    return `WORKSPACE TOOLS ARE CONNECTED. Your previous response did not complete the requested action.
Task: ${task}
Workspace: ${workspaceRoot}
Previous invalid response:
${previous}

Continue the task now. Reply with exactly one one-line JSON tool call and no prose or markdown.
Available write tools include mkdir, write_file, append_file, delete_file, and delete_dir.
Example: {"tool":"write_file","path":"relative/file.md","content":"full content"}`;
  }
  const requiredCall = browserOnly
    ? '{"tool":"browser_snapshot","maxTextChars":8000,"includeScreenshot":true}'
    : '{"tool":"list_files","path":".","maxDepth":4,"maxEntries":500}';
  const previous = String(previousText || "").trim().slice(0, 1200);
  return `TOOL CALL REQUIRED. Your previous response did not execute anything.
Task: ${task}
Workspace: ${workspaceRoot}
Previous invalid text-only response:
${previous}

Reply with exactly this one-line JSON object and no prose, markdown, explanation, or provider-native function call:
${requiredCall}`;
}

export function isWorkspaceToolUnavailableResponse(text) {
  const value = String(text || "");
  return /(?:нет|отсутствует|не имею)[^\n.]{0,100}(?:workspace|рабоч|локальн)[^\n.]{0,60}инструмент|(?:workspace|рабоч|локальн)[^\n.]{0,60}инструмент[^\n.]{0,100}(?:недоступ|не подключ|отсутств)|(?:no|without|don't have|do not have)[^\n.]{0,80}workspace\s+tools?|workspace\s+tools?[^\n.]{0,80}(?:not available|unavailable|not connected)/iu.test(value);
}

export function shouldRejectUnexecutedCodeFinish(task, text, hasSuccessfulWorkspaceAction) {
  if (/^(?:как|что|почему|зачем|объясни|расскажи|покажи пример|explain|what|why|how|tell me)(?=\s|[?:,.!]|$)/iu.test(String(task || '').trim())
    || /(?:составь|напиши|покажи|предложи)\s+план|(?:write|create|give|propose)\s+(?:me\s+)?(?:a\s+)?plan/iu.test(String(task || ''))) return false;
  return hasSuccessfulWorkspaceAction === false
    && /(create|make|fix|edit|update|write|build|implement|создай|сделай|исправ|добав|удали|измен|напиш|реализ|почини|обнов)/iu.test(String(task || ""))
    && /(готово|создал|сделал|исправил|изменил|обновил|реализовал|updated|created|done|finished|добавил|удалил|fixed|implemented)/iu.test(String(text || ""));
}

export function shouldRejectTextOnlyCodeResult(task, text, toolLogs = [], hasSuccessfulWorkspaceAction) {
  const answer = String(text || "").trim();
  if (!answer) return false;

  const taskText = String(task || "").trim();
  const answerLower = answer.toLowerCase();

  if (/^(как|что|почему|зачем|объясни|расскажи|покажи пример|explain|what|why|how|tell me)(?=\s|[?:,.!]|$)/iu.test(taskText)) {
    return false;
  }

  if (shouldRejectPendingCodeWork(task, answer)) return true;
  if (isWorkspaceToolUnavailableResponse(answer)) return true;

  if (/environment mismatch|workspace files are not accessible/i.test(answer)) return true;
  if (/не могу гарантировать|cannot guarantee|may not reach|не доход/i.test(answerLower)) return true;
  if (/(?:tool|function)\s+(?:read_file|write_file|list_files|run_command|run_shell|mkdir|delete_file|delete_dir|append_file)\s+(?:does not exist|does not exists|not found|is not available)/i.test(answer)) {
    return true;
  }
  if (/инструмент[^\n.]{0,80}(?:недоступ|не найден|не существует)/iu.test(answerLower)) return true;
  if (/(?:нет|отсутствует)[^\n.]{0,80}инструмент[^\n.]{0,80}(?:запис|файл|рабоч|workspace)/iu.test(answerLower)) return true;
  if (/инструмент[^\n.]{0,80}не подключ[её]н/iu.test(answerLower)) return true;
  if (/инструмент[а-яё]*\s+(?:для\s+)?запис[^\n.]{0,100}(?:\bнет\b|отсутств|недоступ)/iu.test(answerLower)) return true;
  if (/(?:инструмент|workspace|рабоч)[^\n.]{0,100}(?:только\s+чтени|read[- ]?only)/iu.test(answerLower)) return true;
  if (/(?:не могу|cannot|can't)[^\n.]{0,100}(?:созда|измен|запис|write|create|modify)[^\n.]{0,100}(?:файл|workspace|рабоч)/iu.test(answerLower)) return true;
  if (/(?:no|without)[^\n.]{0,80}(?:workspace|file|write)[^\n.]{0,40}tool/i.test(answerLower)) return true;
  if (/могу сделать.*скажи|tell me if you want|ready to proceed|i can do it|готов приступ/i.test(answerLower)) {
    return true;
  }

  if (shouldRejectUnexecutedCodeFinish(task, answer, hasSuccessfulWorkspaceAction)) return true;

  if (toolLogs.length > 0) return false;

  const browserTask = /(найди|найти|поиск|поищи|посмотри|взгляни|сравни|как\s+выглядит|search|look\s+up|browse|compare|open\s+(?:the\s+)?(?:site|page)|открой|нажми|кликн|browser|google|гугл|сайт|страниц|узнай|собери|загугли|cookie|consent|accept|принять)/iu.test(taskText);
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

export function shouldRejectPendingCodeWork(task, text) {
  // Plans requested by the user are valid answers. A promise to perform the
  // next code action is not a final result, even after successful file reads
  // or when the user only asks "ну что?" in an existing implementation chat.
  if (/^(?:как|что|почему|зачем|объясни|расскажи|покажи пример|explain|what|why|how|tell me)(?=\s|[?:,.!]|$)/iu.test(String(task || '').trim())
    || /(?:составь|напиши|покажи|предложи)\s+план|(?:write|create|give|propose)\s+(?:me\s+)?(?:a\s+)?plan/iu.test(String(task || ''))) return false;
  return /\bI(?:['’]ll|\s+will)\s+(?:now\s+)?(?:implement|add|edit|update|write|fix|extend|create)\b|\blet me (?:start|begin)\s+by\s+(?:implementing|adding|editing|updating|writing|fixing|extending|creating)\b|(?:сейчас|теперь|далее)\s+(?:добавлю|изменю|напишу|исправлю|реализую|создам|приступлю)/iu.test(String(text || ''));
}

export function isProjectAnalysisTask(task) {
  const value = String(task || "").trim();
  if (!value) return false;
  if (/(?:что|как|какие|какую)[^\n]{0,100}улучш[^\n]{0,100}(?:проект|репозитор)|(?:рекомендац|посовет)[^\n]{0,100}(?:проект|репозитор)|(?:проект|репозитор)[^\n]{0,100}(?:рекомендац|посовет)/iu.test(value)) return true;
  if (/(?:изучи|проанализир|оцени|проверь|inspect|review|analy[sz]e)\s+(?:текущ[а-я]*\s+|наш[а-я]*\s+|эт[а-я]*\s+)?(?:проект|репозитор|кодовую\s+базу|project|repo(?:sitory)?|codebase)/iu.test(value)) return true;
  if (/(?:наш[а-я]*|эт[а-я]*|текущ[а-я]*)\s+(?:программ|приложени|проект|репозитор)[а-я]*/iu.test(value)
    && /(?:изучи|проанализир|анализ|оцени|расскаж|скаж|какую\s+задач|что\s+(?:улучш|добав|можно)|рекомендац|review|analy[sz]e|improv)/iu.test(value)) return true;
  return /(?:что\s+думаешь|проанализир(?:уй|овать)|анализ|оцени|оценка|проведи\s+ревью|сделай\s+ревью|слабые\s+места|сильные\s+стороны|what\s+do\s+you\s+think|analy[sz]e|review|evaluate|assess)[^\n]{0,100}(?:проект|репозитор|код(?:ов(?:ую|ая)\s+базу)?|project|repo(?:sitory)?|codebase)/iu.test(value);
}

export function getProjectAnalysisCoverage(toolLogs = []) {
  const files = new Set();
  for (const log of toolLogs) {
    const value = String(log || "");
    if (/\nerror:/iu.test(value)) continue;
    const match = /^\[tool\]\s+read_file\s+([^\n]+)/iu.exec(value);
    if (match) files.add(match[1].trim().replaceAll("\\", "/"));
  }

  const paths = [...files];
  const isTestPath = (file) => (
    /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/iu.test(file)
    || /(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/iu.test(file)
  );
  return {
    files: paths,
    hasDocumentation: paths.some((file) => /(?:^|\/)(?:readme|agents)(?:\.[^/]*)?$/iu.test(file)),
    hasSource: paths.some((file) => (
      !isTestPath(file)
      && (
        /(?:^|\/)(?:src|api|bin|packages|app|lib)\//iu.test(file)
        || /\.(?:[cm]?[jt]sx?|py|rb|php|go|rs|java|kt|kts|cs|cpp|cc|c|h)$/iu.test(file)
      )
    )),
    hasTestOrConfig: paths.some((file) => (
      isTestPath(file)
      || /(?:^|\/)(?:package\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|build\.gradle(?:\.kts)?|requirements[^/]*\.txt)$/iu.test(file)
    )),
  };
}

export function shouldRejectPrematureProjectAnalysisFinish(task, message, toolLogs = []) {
  if (!isProjectAnalysisTask(task)) return false;
  const coverage = getProjectAnalysisCoverage(toolLogs);
  return coverage.files.length < 3
    || !coverage.hasDocumentation
    || !coverage.hasSource
    || !coverage.hasTestOrConfig
    || String(message || "").trim().length < 500;
}

export function buildProjectAnalysisCorrectionPrompt(task, message, toolLogs = []) {
  const coverage = getProjectAnalysisCoverage(toolLogs);
  const missing = [];
  if (!coverage.hasDocumentation) missing.push("README/AGENTS documentation");
  if (!coverage.hasSource) missing.push("a representative source file");
  if (!coverage.hasTestOrConfig) missing.push("a test or project manifest/config");

  if (coverage.files.length < 3 || missing.length) {
    return [
      `Continue the project analysis for: ${task}`,
      `Evidence read so far: ${coverage.files.join(", ") || "none"}.`,
      `Still inspect ${missing.join(", ") || "another representative project file"}.`,
      "Call read_file for exactly one useful file now. Do not finish yet and do not add prose.",
    ].join("\n");
  }

  return [
    `Finish the project analysis for: ${task}`,
    `The previous conclusion was too short (${String(message || "").trim().length} characters).`,
    "Call finish with a detailed report of at least 500 characters: overview, strengths, weaknesses/risks, prioritized recommendations, and references to inspected files.",
  ].join("\n");
}
