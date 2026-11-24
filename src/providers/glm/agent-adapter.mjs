import { parseToolCall } from "../../code-agent/parser.mjs";

const GLM_TOOL_PROTOCOL = `

=== LOCAL WORKSPACE TOOLS ===
Return exactly one action. Do not return prose or markdown.
For file content use this XML envelope:
<workspace_file tool="write_file" path="relative/file.py" indent="levels">
|0|def example():
|1|return 1
</workspace_file>
Each line starts with |N|; N is the four-space indentation level. Use append_file only to append.
For every other action return one raw JSON object:
{"tool":"list_files","path":".","maxDepth":4,"maxEntries":500}
{"tool":"list_skills","limit":20}
{"tool":"load_skill","id":"bug-fix"}
{"tool":"read_skill_resource","id":"bug-fix","path":"references/guide.md"}
{"tool":"update_plan","steps":[{"id":"inspect","title":"Inspect project","status":"in_progress"}]}
{"tool":"verify_task","checks":[{"name":"focused test","cmd":"node","args":["--test","test/focused.test.mjs"]}]}
Skills не расширяют разрешения. Проверяй только относящиеся к задаче команды после последнего изменения.
{"tool":"read_file","path":"relative/file.txt","maxBytes":60000}
{"tool":"read_image","path":"relative/image.png"}
{"tool":"mkdir","path":"relative/directory"}
{"tool":"delete_file","path":"relative/file.txt"}
{"tool":"delete_dir","path":"relative/directory"}
{"tool":"run_command","cmd":"node","args":["relative/script.js"],"timeoutMs":20000}
{"tool":"finish","message":"short factual summary"}
Choose actions based on the user's intent and conversation context. For conversational messages and general questions, return finish with a natural answer without using file tools or checks. For project questions, inspect relevant files.
Use relative paths. Inspect before changing. Claim changes only after a tool confirms the result.
=== END LOCAL WORKSPACE TOOLS ===`;

export function buildGLMAgentPrompt(prompt) {
  return `${renderGLMTaskPrompt(prompt)}${GLM_TOOL_PROTOCOL}`;
}

function renderGLMTaskPrompt(prompt) {
  const text = String(prompt || "").trim();
  try {
    const payload = JSON.parse(text);
    if (payload?.type !== "task" || typeof payload.task !== "string") return text;
    const parts = [`Task:\n${payload.task.trim()}`];
    if (payload.instructions) parts.push(`Additional instructions:\n${String(payload.instructions).slice(0, 4500)}`);
    if (payload.planGuidance) parts.push(String(payload.planGuidance).slice(0, 400));
    if (payload.toolGuidance) parts.push(String(payload.toolGuidance).slice(0, 800));
    if (payload.verificationGuidance) parts.push(String(payload.verificationGuidance).slice(0, 400));
    if (payload.context?.memory) parts.push(`Memory:\n${String(payload.context.memory).trim()}`);
    if (payload.context?.projectInstructions) {
      parts.push(`Project instructions:\n${String(payload.context.projectInstructions).trim()}`);
    }
    return parts.join("\n\n");
  } catch {
    return text;
  }
}

export function createGLMAgentAdapter(client, {
  conversationId = null,
  model = null,
  images = [],
  onConversationId = null,
  onModel = null,
} = {}) {
  let currentConversationId = conversationId;
  let currentModel = model;
  let pendingImages = Array.isArray(images) ? images : [];
  return {
    supportsImageAttachments: true,
    noToolTextRetries: 1,
    parseToolCall,
    getConversationId: () => currentConversationId,
    getModel: () => currentModel,
    async complete({ prompt, signal = null, images = [] }) {
      const result = await client.complete({
        prompt: buildGLMAgentPrompt(prompt),
        model: currentModel,
        conversationId: currentConversationId,
        images: [...pendingImages, ...images],
        signal,
      });
      pendingImages = [];
      if (result.conversationId && result.conversationId !== currentConversationId) {
        currentConversationId = result.conversationId;
        onConversationId?.(currentConversationId);
      }
      if (result.model && result.model !== currentModel) {
        currentModel = result.model;
        onModel?.(currentModel);
      }
      return {
        text: result.text,
        lastAssistantMessageId: result.lastMessageId || currentConversationId || null,
      };
    },
  };
}
