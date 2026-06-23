// Auto Extractor v2 — Structured Experience Builder
// Converts toolLogs into structured agent experience for memory/skills

export function extractExperience(task, toolLogs = []) {
  const actions = [];
  const files = new Set();
  const errors = [];

  const t = String(task || "").toLowerCase();
  const intent = inferIntent(t);

  for (const log of toolLogs || []) {
    const text = String(log || "");

    // Parse [tool] lines
    const match = text.match(/^\[tool\]\s+(\w+)\s*(.*)$/);
    if (!match) continue;

    const tool = match[1];
    const rest = (match[2] || "").trim();

    actions.push({ tool, target: rest });

    // Track file operations
    if (["read_file", "write_file", "delete_file", "append_file", "list_files"].includes(tool)) {
      if (rest) files.add(rest);
    }

    // Track errors
    if (/error|failed|ENOENT|fatal/i.test(text)) {
      errors.push({ tool, message: text });
    }
  }

  const summary = buildSummary(actions, files, errors);

  return {
    task,
    intent,
    actions,
    files: Array.from(files),
    errors,
    summary,
    timestamp: Date.now()
  };
}

function inferIntent(task) {
  if (/(create|make|add|write|implement|build)/.test(task)) return "create";
  if (/(fix|repair|debug|error)/.test(task)) return "fix";
  if (/(update|change|modify|edit)/.test(task)) return "modify";
  if (/(delete|remove)/.test(task)) return "delete";
  if (/(read|analyze|inspect|check)/.test(task)) return "analyze";
  return "general";
}

function buildSummary(actions, files, errors) {
  const ok = errors.length === 0;

  return {
    ok,
    steps: actions.length,
    filesTouched: files.size,
    errors: errors.length,
    insight: ok
      ? "Execution completed successfully"
      : "Execution finished with errors"
  };
}