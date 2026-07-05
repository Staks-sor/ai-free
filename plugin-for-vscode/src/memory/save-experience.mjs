// Сохранение structured experience в memory store после code-agent run.

import { addMemory } from "./store.mjs";
import { linkExperienceToGraph } from "./graph/linker.mjs";

export function saveExperience({ task, experience, workspaceRoot = "" }) {
  if (!experience) return [];

  const workspace = String(workspaceRoot || "");
  const saved = [];
  const intent = experience.intent || "general";
  const files = Array.isArray(experience.files) ? experience.files : [];
  const errors = Array.isArray(experience.errors) ? experience.errors : [];

  const summaryLines = [
    `Task: ${task}`,
    `Intent: ${intent}`,
    `Steps: ${experience.summary?.steps ?? 0}`,
    `Files touched: ${files.length ? files.join(", ") : "none"}`,
    experience.summary?.insight || "",
  ].filter(Boolean);

  const backlinks = files.length
    ? `\n\n## Related\n${files.map((filePath) => `- [[${filePath}]]`).join("\n")}`
    : "";

  const main = addMemory({
    type: errors.length ? "error" : "execution",
    content: summaryLines.join("\n") + backlinks,
    tags: ["agent", intent, ...(errors.length ? ["error"] : ["success"])],
    workspace,
    meta: { important: true, experience },
  });
  if (main) saved.push(main);

  for (const err of errors.slice(0, 5)) {
    const item = addMemory({
      type: "error",
      content: `Task: ${task}\nTool: ${err.tool || "unknown"}\n${err.message || ""}`.trim(),
      tags: ["error", "agent", intent],
      workspace,
      meta: { important: true },
    });
    if (item) saved.push(item);
  }

  if (!errors.length && files.length) {
    const fix = addMemory({
      type: "fix",
      content: `Task: ${task}\nFiles: ${files.join(", ")}\n${experience.summary?.insight || "Completed"}`,
      tags: ["fix", "agent", intent],
      workspace,
      meta: { important: true },
    });
    if (fix) saved.push(fix);
  }

  if (saved.length) {
    linkExperienceToGraph({ task, experience, workspace, savedItems: saved });
  }

  return saved;
}
