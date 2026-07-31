export function createCompactTaskPrompt(task) {
  return JSON.stringify({
    type: "task",
    task: String(task || "").trim(),
  });
}
