export function createCompactTaskPrompt(task, {
  memoryContext = "",
  projectInstructionsContext = "",
} = {}) {
  const payload = {
    type: "task",
    task: String(task || "").trim(),
  };
  const context = {};
  if (String(memoryContext || "").trim()) context.memory = String(memoryContext).trim();
  if (String(projectInstructionsContext || "").trim()) {
    context.projectInstructions = String(projectInstructionsContext).trim();
  }
  if (Object.keys(context).length) payload.context = context;
  return JSON.stringify(payload);
}
