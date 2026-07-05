// Agent Orchestrator — единая точка входа для code-agent с memory + skills.

import { assembleAgentContext } from "./context-assembler.mjs";
import { runCodeTask } from "../code-agent/run.mjs";
import { BROWSER_AGENT_TOOLS } from "../code-agent/browser-prompt.mjs";

export { assembleAgentContext } from "./context-assembler.mjs";
export { classifyTask, shouldUseCodeAgent } from "./task-classifier.mjs";
export { matchSkillByTask } from "../skills/skill-matcher.mjs";

export async function runAgentTask(
  client,
  baseOptions,
  workspaceRoot,
  task,
  parentMessageId = null,
  options = {},
) {
  const browserOnly = options.browserOnly === true;

  const context = browserOnly
    ? {
        skillId: null,
        memoryEnabled: false,
        memoryContext: "",
        memoryUsedCount: 0,
        graphUsedCount: 0,
        allowedTools: BROWSER_AGENT_TOOLS,
        skill: null,
      }
    : assembleAgentContext({
        task,
        workspaceRoot,
        skillId: options.skillId || null,
        memoryEnabled: options.memoryEnabled !== false,
        autoSkill: options.autoSkill !== false,
      });

  let browserContext = "";
  try {
    const { buildBrowserContextSection } = await import("../window-app/browser-snapshot.mjs");
    browserContext = await buildBrowserContextSection();
  } catch {}

  return runCodeTask(client, baseOptions, workspaceRoot, task, parentMessageId, {
    ...options,
    browserOnly,
    skillId: context.skillId,
    memoryEnabled: context.memoryEnabled,
    memoryContext: context.memoryContext,
    browserContext,
    memoryUsedCount: context.memoryUsedCount,
    graphUsedCount: context.graphUsedCount,
    allowedTools: browserOnly ? BROWSER_AGENT_TOOLS : context.allowedTools,
    skillPrompt: context.skill?.prompt || null,
  });
}
