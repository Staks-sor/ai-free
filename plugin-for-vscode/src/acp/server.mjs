import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { runCodeTask } from "../code-agent/run.mjs";
import { AI_FREE_VERSION, DEFAULT_AUTH_FILE } from "../config.mjs";
import { readSavedAuth } from "../auth/files.mjs";
import { DeepSeekChatClient } from "../deepseek/client.mjs";
import { QWEN_AUTH_FILE } from "../providers/qwen/config.mjs";
import { readQwenAuth } from "../providers/qwen/auth-files.mjs";
import { QwenChatClient } from "../providers/qwen/client.mjs";
import { createQwenAgentAdapter } from "../providers/qwen/agent-adapter.mjs";
import { getProviderDefaultModel } from "../providers/model-catalog.mjs";
import { findModel } from "../../api/models.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:4317/v1";

const ROLE_PROMPTS = {
  programmer: `You are a senior software engineering agent.

Work style:
- Read the existing project context before proposing changes.
- Prefer small, safe, working patches over broad rewrites.
- Explain tradeoffs briefly and concretely.
- When editing code, preserve existing architecture, style, and public behavior unless the user asks otherwise.
- For debugging, identify the failure path, make a targeted fix, and verify it.
- You are not a text-only chatbot. You are connected to file tools through the local /code agent.
- When the user asks to create, edit, move, inspect, run, or verify project files, use tools.
- Do not say that you cannot access the file system.
- Do not invent files, APIs, command output, or test results.`,

  recruiter: `You are an HR recruiter agent for software and product teams.

Work style:
- Ask only for missing business-critical details.
- Create structured outputs: vacancy scorecards, outreach messages, interview plans, candidate summaries.
- Be practical, concise, and compliant.
- Do not invent candidate facts. If data is missing, mark it as unknown.
- Avoid discriminatory criteria and protected-class inferences.`,

  sourcer: `You are an HR sourcing agent.

Work style:
- Focus on search strategy, Boolean/X-Ray queries, market mapping, outreach variants, and pipeline organization.
- Keep recommendations actionable and measurable.
- Never claim you contacted or verified a candidate unless the user provided that evidence.
- Avoid protected-class targeting.`,

  interviewer: `You are an HR interview and assessment agent.

Work style:
- Build structured interview kits with competencies, questions, strong/weak signal examples, and scoring rubrics.
- Separate evidence from interpretation.
- Keep the process fair and role-related.
- Avoid questions about protected characteristics or private life.`,

  policy: `You are an HR policy and operations agent.

Work style:
- Draft clear internal HR documents: policies, onboarding checklists, FAQ, employee communications, performance review templates.
- Flag legal/compliance uncertainty instead of pretending to give legal advice.
- Ask for jurisdiction when policy or labor-law detail matters.
- Keep tone professional and employee-friendly.`,
};

export async function runAcpServer({
  input = process.stdin,
  output = process.stdout,
  env = process.env,
} = {}) {
  const sessions = new Map();
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  const write = (message) => {
    output.write(`${JSON.stringify(message)}\n`);
  };

  const respond = (id, result) => write({ jsonrpc: "2.0", id, result });
  const respondError = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });
  const notify = (method, params) => write({ jsonrpc: "2.0", method, params });

  const config = readAcpConfig(env);

  for await (const line of rl) {
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      respondError(null, -32700, "Parse error");
      continue;
    }

    try {
      if (request.method === "initialize") {
        respond(request.id, {
          protocolVersion: 1,
          agentCapabilities: {
            promptCapabilities: {
              embeddedContext: true,
            },
          },
          agentInfo: {
            name: "ai-free-acp",
            title: config.title,
            version: AI_FREE_VERSION,
          },
          authMethods: [],
        });
      } else if (request.method === "session/new") {
        const sessionId = `dscli_${randomUUID()}`;
        sessions.set(sessionId, {
          cwd: request.params?.cwd || process.cwd(),
          messages: [{ role: "system", content: config.systemPrompt }],
          providerSessionId: null,
          parentMessageId: null,
        });
        respond(request.id, { sessionId });
      } else if (request.method === "session/prompt") {
        await handlePrompt({ request, sessions, config, respond, respondError, notify });
      } else if (request.method === "session/cancel") {
        if (request.id !== undefined) respond(request.id, { stopReason: "cancelled" });
      } else {
        if (request.id !== undefined) respondError(request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (error) {
      if (request.id !== undefined) respondError(request.id, -32603, error.message);
    }
  }
}

function readAcpConfig(env) {
  const role = String(env.DSCLI_ACP_ROLE || "programmer").toLowerCase();
  const rolePrompt = ROLE_PROMPTS[role] || ROLE_PROMPTS.programmer;
  const extraPrompt = String(env.DSCLI_ACP_SYSTEM_PROMPT || "").trim();
  const model = String(env.OPENAI_MODEL || env.DSCLI_ACP_MODEL || getProviderDefaultModel("qwen"));
  const mapping = findModel(model);
  if (!mapping) {
    throw new Error(`Unknown ACP model: ${model}`);
  }
  const baseURL = String(env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = String(env.OPENAI_API_KEY || "");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for --acp");
  }
  return {
    role,
    model,
    mapping,
    baseURL,
    apiKey,
    title: env.DSCLI_ACP_TITLE || model,
    systemPrompt: [rolePrompt, extraPrompt].filter(Boolean).join("\n\n"),
  };
}

async function handlePrompt({ request, sessions, config, respond, respondError, notify }) {
  const sessionId = request.params?.sessionId;
  const session = sessions.get(sessionId);
  if (!session) {
    respondError(request.id, -32602, `Unknown sessionId: ${sessionId}`);
    return;
  }

  const userText = contentBlocksToText(request.params?.prompt || []);
  const client = await getAcpCodeClient(config, session);
  const baseOptions = {
    sessionId: session.providerSessionId,
    modelType: config.mapping.model,
    thinkingEnabled: config.mapping.model === "expert",
    searchEnabled: false,
  };

  const codeResult = await runCodeTask(
    client,
    baseOptions,
    session.cwd,
    userText,
    session.parentMessageId,
    {
      systemPrompt: config.systemPrompt,
      onTool: (call, result, log) => notifyToolUpdate(notify, sessionId, call, result, log),
      onAssistant: (message) => {
        notify("session/update", {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: message },
          },
        });
      },
    },
  );

  session.parentMessageId = codeResult.parentMessageId ?? session.parentMessageId;
  session.messages.push({ role: "user", content: userText });
  session.messages.push({ role: "assistant", content: codeResult.message });
  respond(request.id, { stopReason: "end_turn" });
}

async function getAcpCodeClient(config, session) {
  if (config.mapping.provider === "qwen") {
    if (!session.providerSessionId) {
      const auth = readQwenAuth(QWEN_AUTH_FILE);
      if (!auth?.token) throw new Error("Qwen auth missing. Run npm run login-qwen.");
      const qwenClient = new QwenChatClient({
        token: auth.token,
        cookieHeader: auth.cookieHeader,
        debug: Boolean(process.env.DEEPSEEK_DEBUG_QWEN),
      });
      session.qwenClient = qwenClient;
      session.providerSessionId = await qwenClient.createChat({
        title: "PyCharm ACP agent",
        model: config.mapping.model,
      });
    }
    return createQwenAgentAdapter(session.qwenClient);
  }

  if (!session.providerSessionId) {
    const auth = readSavedAuth(DEFAULT_AUTH_FILE);
    if (!auth?.token || !auth?.cookieHeader) throw new Error("DeepSeek auth missing. Run npm run login.");
    session.deepseekClient = new DeepSeekChatClient({
      token: auth.token,
      cookieHeader: auth.cookieHeader,
      hifLeim: auth.hifLeim,
      debug: Boolean(process.env.API_DEBUG),
    });
    session.providerSessionId = await session.deepseekClient.createSession();
  }
  return session.deepseekClient;
}

function notifyToolUpdate(notify, sessionId, call, result, log) {
  const toolCallId = `tool_${randomUUID()}`;
  const title = `${call.tool}${call.path ? ` ${call.path}` : ""}${call.cmd ? ` ${call.cmd}` : ""}`.trim();
  const kind = toolKind(call.tool);
  notify("session/update", {
    sessionId,
    update: {
      sessionUpdate: "tool_call",
      toolCallId,
      title,
      kind,
      status: "in_progress",
      rawInput: call,
    },
  });
  notify("session/update", {
    sessionId,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: result?.ok === false ? "failed" : "completed",
      content: [
        {
          type: "content",
          content: { type: "text", text: log },
        },
      ],
      rawOutput: result,
    },
  });
}

function toolKind(tool) {
  if (tool === "read_file" || tool === "list_files") return "read";
  if (tool === "write_file" || tool === "append_file" || tool === "delete_file") return "edit";
  if (tool === "mkdir") return "edit";
  if (tool === "run_command") return "execute";
  return "other";
}

function contentBlocksToText(blocks) {
  return blocks.map((block) => {
    if (block?.type === "text") return block.text || "";
    if (block?.type === "resource" && block.resource?.text) {
      return `[Resource: ${block.resource.uri || "embedded"}]\n${block.resource.text}`;
    }
    if (block?.type === "resource_link") {
      return `[Resource link: ${block.uri || block.name || "unknown"}]`;
    }
    return `[Unsupported content block: ${block?.type || "unknown"}]`;
  }).filter(Boolean).join("\n\n");
}
