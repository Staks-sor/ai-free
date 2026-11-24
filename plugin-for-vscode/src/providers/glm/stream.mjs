function completionFailure(terminal, reason) {
  return { ok: false, text: "", terminal, reason };
}

/**
 * Parses only the documented OpenAI-compatible Chat Completions SSE fields
 * used by GLM's observed generation route. A caller must separately bind the
 * response to its submitted prompt and uploaded image references.
 */
export function parseGLMNativeSseCompletion(stream) {
  let terminal = false;
  let malformed = false;
  let hasError = false;
  let unsuccessfulFinish = false;
  let deltaText = "";
  let messageText = null;

  for (const line of String(stream || "").split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    if (data === "[DONE]") {
      terminal = true;
      continue;
    }

    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      malformed = true;
      continue;
    }
    if (payload?.error) hasError = true;

    if (payload?.type === "chat:completion" && payload?.data && typeof payload.data === "object") {
      if (payload.data.done === true && (payload.data.phase === "answer" || payload.data.phase === "done")) terminal = true;
      if (payload.data.phase === "answer" && typeof payload.data.delta_content === "string") {
        deltaText += payload.data.delta_content;
      }
    }

    const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
    if (!choice || typeof choice !== "object") continue;
    if (typeof choice.finish_reason === "string" && choice.finish_reason.trim() && choice.finish_reason !== "null") {
      terminal = true;
      if (!["stop", "end"].includes(choice.finish_reason)) unsuccessfulFinish = true;
    }
    if (typeof choice.delta?.content === "string") deltaText += choice.delta.content;
    if (typeof choice.message?.content === "string") messageText = choice.message.content;
  }

  if (!terminal) return completionFailure(false, "nonterminal");
  if (hasError || malformed || unsuccessfulFinish) return completionFailure(true, "error");
  const text = messageText ?? deltaText;
  if (!text.trim()) return completionFailure(true, "empty");
  return { ok: true, text, terminal: true };
}

/** Returns only structural counters for debug diagnostics. */
export function summarizeGLMNativeSse(stream) {
  const phaseValues = new Set();
  let doneTrueCount = 0;
  let doneFalseCount = 0;
  let deltaChars = 0;
  for (const line of String(stream || "").split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    let payload;
    try { payload = JSON.parse(line.slice(5).trim()); } catch { continue; }
    if (!payload?.data || typeof payload.data !== "object") continue;
    if (typeof payload.data.phase === "string") phaseValues.add(payload.data.phase);
    if (payload.data.done === true) doneTrueCount += 1;
    if (payload.data.done === false) doneFalseCount += 1;
    if (typeof payload.data.delta_content === "string") deltaChars += payload.data.delta_content.length;
  }
  return { phaseValues: [...phaseValues].sort(), doneTrueCount, doneFalseCount, deltaChars };
}
