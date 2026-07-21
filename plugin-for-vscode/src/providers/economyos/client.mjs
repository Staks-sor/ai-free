import { randomUUID } from "node:crypto";

import { ECONOMYOS_DEFAULT_BASE_URL } from "../../state/settings.mjs";

export class EconomyOSClient {
  constructor({ apiKey, baseUrl = ECONOMYOS_DEFAULT_BASE_URL, fetchImpl = globalThis.fetch, nativeRequestIntervalMs = 2_500 } = {}) {
    this.apiKey = String(apiKey || "").trim();
    this.baseUrl = String(baseUrl || ECONOMYOS_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.sessions = new Map();
    this.nativeRequestIntervalMs = Math.max(0, Number(nativeRequestIntervalMs) || 0);
    this.nextNativeRequestAt = 0;
    this.supportsNativeTools = true;
    if (!this.apiKey) throw new Error("EconomyOS API key is not configured.");
    if (typeof this.fetchImpl !== "function") throw new Error("Fetch is not available.");
  }

  async createSession() {
    const id = randomUUID();
    this.sessions.set(id, []);
    return id;
  }

  hasSession(sessionId) {
    return Boolean(sessionId && this.sessions.has(sessionId));
  }

  exportSession(sessionId) {
    const history = this.sessions.get(sessionId);
    return Array.isArray(history) ? structuredClone(compactToolHistory(history)) : [];
  }

  restoreSession(sessionId, messages = []) {
    if (!sessionId) throw new Error("EconomyOS session id is required.");
    this.sessions.set(sessionId, structuredClone(Array.isArray(messages) ? messages : []));
    return sessionId;
  }

  async listModels({ signal = null } = {}) {
    const response = await this.fetchImpl(`${this.baseUrl}/models`, {
      headers: this.#headers(),
      signal,
    });
    if (!response.ok) throw await responseError(response, "EconomyOS model catalog");
    const payload = await response.json();
    return Array.isArray(payload?.data) ? payload.data : [];
  }

  async complete({ prompt, model, sessionId = null, messages = null, images = [], systemPrompt = "", tools = null, toolResult = null, onText = null, signal = null } = {}) {
    const history = Array.isArray(messages)
      ? normalizeMessages(messages)
      : [...(this.sessions.get(sessionId) || [])];
    if (systemPrompt && !history.some((message) => message.role === "system")) {
      history.unshift({ role: "system", content: String(systemPrompt) });
    }
    if (toolResult?.toolCallId) {
      history.push({ role: "tool", tool_call_id: toolResult.toolCallId, content: JSON.stringify(toolResult.result) });
    }
    const userPrompt = String(prompt || "");
    if (userPrompt) {
      const includeImages = !history.some(hasImageContent);
      history.push({ role: "user", content: includeImages ? makeUserContent(userPrompt, images) : userPrompt });
    }

    const nativeTools = Array.isArray(tools) && tools.length > 0;
    const request = {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify({
        model: String(model || "z-ai-glm-4-7-flash"),
        messages: nativeTools ? compactToolHistory(history) : history,
        stream: !nativeTools,
        ...(nativeTools
          ? { tools, tool_choice: "auto", parallel_tool_calls: false }
          : {}),
      }),
      signal,
    };
    let text = "";
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let emitted = false;
      const emit = typeof onText === "function"
        ? (chunk) => { emitted = true; onText(chunk); }
        : null;
      try {
        // Pace every completion, not only tool calls. Team/pipeline agents can otherwise
        // start several ordinary completions at once and trigger provider-wide 429s.
        await this.#paceNativeRequest(signal);
        const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, request);
        if (!response.ok) throw await responseError(response, "EconomyOS completion");
        const contentType = String(response.headers.get("content-type") || "");
        const parsed = contentType.includes("text/event-stream")
          ? await readSseResponse(response, emit)
          : await readJsonResponse(response, emit);
        text = parsed.text;
        if (sessionId) this.sessions.set(sessionId, [...history, parsed.assistantMessage]);
        return { text, toolCall: parsed.toolCall, lastAssistantMessageId: randomUUID() };
        break;
      } catch (error) {
        if (signal?.aborted || emitted || !isTransientTransportError(error)) throw error;
        if (attempt >= maxAttempts - 1) {
          const failure = new Error(
            error?.status === 429
              ? "EconomyOS rate limit is still active. The agent checkpoint was preserved and can continue without repeating completed tools."
              : `EconomyOS is still unavailable after ${maxAttempts} attempts. The agent checkpoint was preserved and can continue safely.`,
            { cause: error },
          );
          failure.code = "ECONOMYOS_TEMPORARILY_UNAVAILABLE";
          failure.retryable = true;
          failure.status = error?.status || 0;
          throw failure;
        }
        await delay(retryDelayMs(error, attempt), signal);
      }
    }

    return { text, lastAssistantMessageId: randomUUID() };
  }

  #headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "User-Agent": "AI-Free/EconomyOS",
    };
  }

  async #paceNativeRequest(signal) {
    // Reserve a slot before awaiting. This makes concurrent callers form a queue
    // instead of waking together and sending a burst after the same timeout.
    const now = Date.now();
    const slotAt = Math.max(now, this.nextNativeRequestAt);
    this.nextNativeRequestAt = slotAt + this.nativeRequestIntervalMs;
    const waitMs = Math.max(0, slotAt - now);
    if (waitMs) await delay(waitMs, signal);
  }
}

function isTransientTransportError(error) {
  const status = Number(error?.status || 0);
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const text = `${error?.message || error} ${error?.cause?.code || ""}`.toLowerCase();
  return /terminated|econnreset|econnrefused|etimedout|fetch failed|socket|other side closed|network/.test(text);
}

function retryDelayMs(error, attempt) {
  if (Object.hasOwn(error || {}, "retryAfterMs")) {
    return Math.min(Math.max(0, Number(error.retryAfterMs) || 0), 30_000);
  }
  if (Number(error?.status) === 429) return Math.min(5_000 * (2 ** attempt), 30_000);
  return Math.min(500 * (2 ** attempt), 10_000);
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error("Request stopped by user."));
    }, { once: true });
  });
}

function normalizeMessages(messages) {
  return messages
    .filter((message) => message && ["system", "user", "assistant", "tool"].includes(message.role))
    .map((message) => ({ role: message.role, content: normalizeMessageContent(message.content) }))
    .filter((message) => message.content && message.content !== "…" && message.content !== "[empty]");
}

function compactToolHistory(history) {
  const toolCount = history.filter((message) => message.role === "tool").length;
  let toolIndex = 0;
  return history.map((message) => {
    if (message.role !== "tool") return message;
    toolIndex += 1;
    const limit = toolIndex <= Math.max(0, toolCount - 6) ? 2000 : 14000;
    const content = String(message.content || "");
    if (content.length <= limit) return message;
    return {
      ...message,
      content: `${content.slice(0, limit)}\n[older tool result truncated]`,
    };
  });
}

function normalizeMessageContent(content) {
  if (!Array.isArray(content)) return String(content || "");
  return content.filter((part) => part && (part.type === "text" || part.type === "image_url"));
}

function hasImageContent(message) {
  return Array.isArray(message?.content) && message.content.some((part) => part?.type === "image_url");
}

function makeUserContent(prompt, images) {
  const validImages = Array.isArray(images)
    ? images.filter((image) => image?.dataBase64 && /^image\/(png|jpeg|jpg|gif|webp)$/i.test(String(image.mimeType || "")))
    : [];
  if (!validImages.length) return prompt;
  return [
    { type: "text", text: prompt },
    ...validImages.map((image) => ({
      type: "image_url",
      image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}` },
    })),
  ];
}

async function readSseResponse(response, onText) {
  if (!response.body) return { text: "", toolCall: null, assistantMessage: { role: "assistant", content: "" } };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  const toolCalls = [];

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let event;
      try { event = JSON.parse(data); } catch { continue; }
      const delta = event?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        answer += delta;
        if (typeof onText === "function") onText(delta);
      }
      for (const part of event?.choices?.[0]?.delta?.tool_calls || []) {
        const index = Number(part.index) || 0;
        toolCalls[index] ||= { id: "", type: "function", function: { name: "", arguments: "" } };
        if (part.id) toolCalls[index].id += part.id;
        if (part.function?.name) toolCalls[index].function.name += part.function.name;
        if (part.function?.arguments) toolCalls[index].function.arguments += part.function.arguments;
      }
    }
    if (done) break;
  }
  return makeParsedResponse(answer, toolCalls);
}

async function readJsonResponse(response, onText) {
  const payload = await response.json();
  const text = String(payload?.choices?.[0]?.message?.content || "");
  if (text && typeof onText === "function") onText(text);
  return makeParsedResponse(text, payload?.choices?.[0]?.message?.tool_calls || []);
}

function makeParsedResponse(text, toolCalls) {
  const native = toolCalls?.[0];
  let args = {};
  try { args = JSON.parse(native?.function?.arguments || "{}"); } catch {}
  const toolCall = native?.function?.name
    ? { id: native.id || randomUUID(), name: native.function.name, arguments: args && typeof args === "object" ? args : {} }
    : null;
  const assistantMessage = toolCall
    ? { role: "assistant", content: text || null, tool_calls: toolCalls }
    : { role: "assistant", content: text };
  return { text, toolCall, assistantMessage };
}

async function responseError(response, label) {
  let detail = "";
  try {
    const payload = await response.json();
    detail = String(payload?.error?.message || payload?.message || "");
  } catch {}
  const suffix = detail ? `: ${detail.slice(0, 500)}` : "";
  const error = new Error(`${label} failed (HTTP ${response.status})${suffix}`);
  error.status = response.status;
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const dateMs = Date.parse(retryAfter);
    error.retryAfterMs = Number.isFinite(seconds)
      ? Math.max(0, seconds * 1000)
      : Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
  }
  return error;
}
