const TOOL_PROTOCOL = `

=== SYNVOX workspace tools ===
Return exactly one action, without prose or markdown.
For file content use:
<workspace_file tool="write_file" path="relative/file.txt" indent="levels">
|0|content
</workspace_file>
Each |N| is a four-space indentation level.
For other actions return one raw JSON object:
{"tool":"list_files","path":".","maxDepth":4,"maxEntries":500}
{"tool":"read_file","path":"relative/file.txt","maxBytes":60000}
{"tool":"read_image","path":"relative/image.png"}
{"tool":"list_skills","offset":0,"limit":20}
{"tool":"load_skill","id":"bug-fix"}
{"tool":"read_skill_resource","id":"bug-fix","path":"references/guide.md"}
{"tool":"mkdir","path":"relative/directory"}
{"tool":"delete_file","path":"relative/file.txt"}
{"tool":"delete_dir","path":"relative/directory"}
{"tool":"run_command","cmd":"node","args":["relative/script.js"],"timeoutMs":20000}
{"tool":"update_plan","steps":[{"id":"inspect","title":"Inspect project","status":"in_progress"}]}
{"tool":"verify_task","checks":[{"name":"focused test","cmd":"node","args":["--test","test/focused.test.mjs"]}]}
{"tool":"finish","message":"short factual summary"}
Use relative Project paths. In Computer mode, absolute paths are also allowed. read_image accepts valid PNG, JPEG, GIF, WebP, or BMP files up to 16 MB. Inspect before changing. Finish only after confirming results.
=== END SYNVOX workspace tools ===`;

function renderTask(prompt) {
  const text = String(prompt || "").trim();
  try {
    const payload = JSON.parse(text);
    if (payload?.type !== "task" || typeof payload.task !== "string") return text;
    const parts = [`Task:\n${payload.task.trim()}`];
    if (payload.instructions) parts.push(`Additional instructions:\n${String(payload.instructions).slice(0, 4500)}`);
    if (payload.planGuidance) parts.push(String(payload.planGuidance).slice(0, 400));
    if (payload.toolGuidance) parts.push(String(payload.toolGuidance).slice(0, 400));
    if (payload.verificationGuidance) parts.push(String(payload.verificationGuidance).slice(0, 400));
    if (payload.context?.memory) parts.push(`Memory:\n${String(payload.context.memory).trim()}`);
    if (payload.context?.projectInstructions) parts.push(`Project instructions:\n${String(payload.context.projectInstructions).trim()}`);
    return parts.join("\n\n");
  } catch { return text; }
}

export function buildExternalAgentPrompt(prompt) {
  return `${renderTask(prompt)}${TOOL_PROTOCOL}`;
}
