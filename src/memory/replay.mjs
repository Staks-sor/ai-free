// Memory Replay (anti-bug repetition layer)
// Отвечает за:
// 1) вытаскивание прошлых ошибок
// 2) подбор похожих багов
// 3) возврат "анти-повтора" в prompt

import { searchMemory } from "./store.mjs";

export function getAntiRepeatContext(task, workspaceRoot = "") {
  const query = `${task} ${workspaceRoot}`;
  const memories = searchMemory(query);

  const errors = memories.filter(m =>
    m.type === "error" ||
    (m.tags || []).includes("error")
  );

  const fixes = memories.filter(m =>
    m.type === "fix" ||
    (m.tags || []).includes("fix")
  );

  const recent = memories.slice(0, 10);

  return {
    summary: buildSummary(errors, fixes),
    raw: {
      errors,
      fixes,
      recent
    }
  };
}

function buildSummary(errors, fixes) {
  if (!errors.length && !fixes.length) {
    return "No previous similar errors found.";
  }

  const lines = [];

  if (errors.length) {
    lines.push("KNOWN ERRORS TO AVOID:");
    for (const e of errors.slice(0, 5)) {
      lines.push(`- ${e.content}`);
    }
  }

  if (fixes.length) {
    lines.push("KNOWN FIXES:");
    for (const f of fixes.slice(0, 5)) {
      lines.push(`- ${f.content}`);
    }
  }

  return lines.join("\n");
}
