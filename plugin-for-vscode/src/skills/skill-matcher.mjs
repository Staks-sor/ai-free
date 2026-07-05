// Auto-match skill по ключевым словам в задаче (MVP без LLM-router).

import { listInstalledSkills } from "./registry.mjs";

const RULES = [
  {
    skillId: "code-review",
    patterns: [/code review/i, /\breview\b/i, /ревью/i, /проверь код/i, /review the code/i],
  },
  {
    skillId: "bug-fix",
    patterns: [/\bbug\b/i, /\bfix\b/i, /баг/i, /ошибк/i, /исправ/i, /почини/i, /debug/i],
  },
];

export function matchSkillByTask(task, { exclude = [] } = {}) {
  const text = String(task || "");
  const blocked = new Set(exclude);

  for (const rule of RULES) {
    if (blocked.has(rule.skillId)) continue;
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return rule.skillId;
    }
  }

  const lower = text.toLowerCase();
  for (const skill of listInstalledSkills()) {
    if (blocked.has(skill.id)) continue;
    const desc = String(skill.description || "").toLowerCase();
    if (!desc || desc.length < 8) continue;
    const tokens = desc.split(/[^a-z0-9\u0400-\u04ff]+/i).filter((token) => token.length >= 5);
    const hits = tokens.filter((token) => lower.includes(token));
    if (hits.length >= 2) return skill.id;
  }

  return null;
}
