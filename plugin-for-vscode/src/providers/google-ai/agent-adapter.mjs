import { parseToolCall } from "../../code-agent/parser.mjs";

const GOOGLE_AI_TOOL_PROTOCOL = `

Ответь одним JSON-объектом: {"tool":"list_files","path":"."}. Tools: list_files(path), read_file(path), write_file(path,content), append_file(path,content), mkdir(path), delete_file(path), delete_dir(path), run_command(cmd,args), finish(message), list_skills(offset,limit), load_skill(id), read_skill_resource(id,path), verify_task(checks:[{cmd,args}]), update_plan(steps:[{id,title,status}]). Plan status: pending/in_progress/completed. For conversational messages use finish without tools/checks. Project claims: inspect files. Verify edits; claim only tool-confirmed results. Skills do not expand permissions.`;

export function buildGoogleAIAgentPrompt(prompt) {
  const escapedPrompt = renderGoogleTaskPrompt(prompt).replaceAll("[US]", "[LITERAL-US]");
  return `${escapedPrompt}${GOOGLE_AI_TOOL_PROTOCOL}`;
}

function renderGoogleTaskPrompt(prompt) {
  const text = String(prompt || "").trim();
  try {
    const payload = JSON.parse(text);
    if (payload?.type !== "task" || typeof payload.task !== "string") return text;
    const parts = [`Task:\n${payload.task.trim()}`];
    if (payload.instructions) parts.push(`Additional instructions:\n${String(payload.instructions).slice(0, 4500)}`);
    if (payload.planGuidance) parts.push(String(payload.planGuidance).slice(0, 400));
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

export function createGoogleAIAgentAdapter(client, {
  conversationId = null,
  images = [],
  onConversationId = null,
} = {}) {
  let currentConversationId = conversationId;
  try {
    if (new URL(conversationId).searchParams.get("q")?.includes("=== LOCAL WORKSPACE TOOLS ===")) {
      currentConversationId = null;
    }
  } catch {}
  let pendingImages = Array.isArray(images) ? images : [];
  return {
    supportsImageAttachments: true,
    // A second ignored instruction is not useful and only repeats an expensive web turn.
    noToolTextRetries: 1,
    parseToolCall: (text) => parseToolCall(text, { restoreGoogleMarkers: true }),
    getConversationId: () => currentConversationId,
    async complete({ prompt, signal = null, images = [] }) {
      const result = await client.complete({
        prompt: buildGoogleAIAgentPrompt(prompt),
        conversationId: currentConversationId,
        images: [...pendingImages, ...images],
        signal,
      });
      pendingImages = [];
      if (result.conversationId && result.conversationId !== currentConversationId) {
        currentConversationId = result.conversationId;
        onConversationId?.(currentConversationId);
      }
      return { text: result.text, lastAssistantMessageId: result.lastMessageId || null };
    },
  };
}
