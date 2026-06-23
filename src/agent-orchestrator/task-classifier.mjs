// Классификация типа задачи (MVP — keyword heuristics).

export function classifyTask(task) {
  const text = String(task || "").toLowerCase();

  if (/^(как|что|почему|зачем|объясни|explain|what|why|how)\b/u.test(text)) {
    return "chat";
  }
  if (/(review|ревью|code review)/i.test(text)) return "review";
  if (/(fix|bug|баг|ошибк|исправ|debug)/i.test(text)) return "fix";
  if (/(create|создай|make|build|implement|напиш|добав)/i.test(text)) return "code";
  return "general";
}

export function shouldUseCodeAgent(task, { coderMode = false, hardwareMode = false } = {}) {
  if (coderMode || hardwareMode) return true;
  const kind = classifyTask(task);
  return kind === "code" || kind === "fix" || kind === "review";
}
