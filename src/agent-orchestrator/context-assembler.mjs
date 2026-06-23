// Сбор контекста перед запуском code-agent: skill + memory.

import { buildMemoryContextResult } from "../memory/context-builder.mjs";
import { matchSkillByTask } from "../skills/skill-matcher.mjs";
import { loadSkill } from "../skills/registry.mjs";
import { getAllowedTools } from "../skills/permissions.mjs";

export function assembleAgentContext({
  task,
  workspaceRoot = "",
  skillId = null,
  memoryEnabled = true,
  autoSkill = false,
} = {}) {
  let resolvedSkillId = skillId || null;

  if (!resolvedSkillId && autoSkill) {
    resolvedSkillId = matchSkillByTask(task);
  }

  let skill = null;
  if (resolvedSkillId) {
    try {
      skill = loadSkill(resolvedSkillId);
    } catch {
      resolvedSkillId = null;
    }
  }

  const memory = buildMemoryContextResult(task, workspaceRoot, { memoryEnabled });

  return {
    skillId: resolvedSkillId,
    skill,
    memoryEnabled: memoryEnabled !== false,
    memoryContext: memory.context,
    memoryUsedCount: memory.usedCount,
    graphUsedCount: memory.graphUsed || 0,
    allowedTools: getAllowedTools(skill),
  };
}
