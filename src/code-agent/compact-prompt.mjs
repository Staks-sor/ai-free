export function createCompactTaskPrompt(task, {
  memoryContext = "",
  projectInstructionsContext = "",
  maxContextChars = null,
  systemPrompt = "",
} = {}) {
  const payload = {
    type: "task",
    task: String(task || "").trim(),
  };
  if (systemPrompt) payload.instructions = String(systemPrompt).slice(0, 4500);
  payload.planGuidance = 'For multi-step workspace tasks, use update_plan with 1–12 explicit steps; keep at most one in_progress and complete all steps before finishing. Skip simple one-step and conversational tasks.';
  payload.toolGuidance = 'Use read_image for a validated PNG, JPEG, GIF, WebP, or BMP file up to 16 MB. Use relative paths in Project mode; Computer mode also permits absolute paths.';
  const contextEntries = [
    ["memory", String(memoryContext || "").trim()],
    ["projectInstructions", String(projectInstructionsContext || "").trim()],
  ].filter(([, value]) => value);
  const context = {};
  const contextLimit = normalizeContextLimit(maxContextChars);
  const entryLimit = contextLimit && contextEntries.length
    ? Math.floor(contextLimit / contextEntries.length)
    : null;
  for (const [key, value] of contextEntries) {
    context[key] = entryLimit ? truncateCompactContext(value, entryLimit) : value;
  }
  if (Object.keys(context).length) payload.context = context;
  return JSON.stringify(payload);
}

function normalizeContextLimit(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export function truncateCompactContext(value, limit) {
  if (value.length <= limit) return value;
  const marker = "\n[truncated]";
  if (limit <= marker.length) return marker.slice(-limit);
  return `${value.slice(0, limit - marker.length)}${marker}`;
}
