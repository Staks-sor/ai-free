// Сбор контекста перед запуском code-agent: project instructions + skill + memory.

import { buildMemoryContextResult } from "../memory/context-builder.mjs";
import { measureMemoryRetrieval } from "../diagnostics/runtime-metrics.mjs";
import { matchSkillByTask } from "../skills/skill-matcher.mjs";
import { loadSkill } from "../skills/registry.mjs";
import { getAllowedTools } from "../skills/permissions.mjs";
import { loadProjectInstructions, loadDevelopmentContext } from "./project-instructions.mjs";

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

  const memory = measureMemoryRetrieval(() => buildMemoryContextResult(task, workspaceRoot, { memoryEnabled }));
  const projectInstructions = loadProjectInstructions(workspaceRoot, { maxTotalBytes: 16 * 1024, maxFiles: 8, maxDirectories: 500 });
  const development = loadDevelopmentContext(workspaceRoot);

  return {
    skillId: resolvedSkillId,
    skill,
    memoryEnabled: memoryEnabled !== false,
    memoryContext: memory.context,
    memoryUsedCount: memory.usedCount,
    graphUsedCount: memory.graphUsed || 0,
    memoryCacheHit: memory.cacheHit === true,
    memoryTruncated: memory.truncated === true,
    projectInstructionsContext: [projectInstructions.context, projectInstructions.truncated ? "Project instruction scan was bounded. Before editing, read the applicable AGENTS.md files in the target directory and its parents." : "", development.context].filter(Boolean).join('\n\n'),
    projectInstructionsCount: projectInstructions.files.length,
    allowedTools: getAllowedTools(skill),
  };
}
