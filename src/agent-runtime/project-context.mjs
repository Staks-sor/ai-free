const DEFAULT_MAX_CHARS = 6_000;
const MAX_OUTPUTS = 4;

function redact(value) {
  return String(value || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*Thought Process[\s\S]*?(?=^(?:RES(?:ULT)?|Итог|Result):?)/gimu, "")
    .replace(/("(?:authorization|cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(authorization|cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1: [REDACTED]")
    .trim();
}

function compact(value, maxChars) {
  const text = redact(value).replace(/\n{3,}/g, "\n\n");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 14)).trimEnd()}\n[…truncated]`;
}

function outputKey(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function buildProjectContextPacket({
  goal = "",
  task = "",
  memoryContext = "",
  outputs = [],
  acceptanceCriteria = "",
  maxChars = DEFAULT_MAX_CHARS,
} = {}) {
  const limit = Math.max(300, Number(maxChars) || DEFAULT_MAX_CHARS);
  const parts = [];
  if (goal) parts.push(`Цель проекта:\n${compact(goal, 800)}`);
  if (task) parts.push(`Текущая задача:\n${compact(task, 1_200)}`);
  if (memoryContext) parts.push(`Проверенные факты проекта:\n${compact(memoryContext, 1_800)}`);

  const seen = new Set();
  const prior = [];
  for (const item of Array.isArray(outputs) ? outputs : []) {
    const text = compact(item?.text, 1_200);
    const key = outputKey(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    prior.push(`[${item.roleId || "agent"} · ${item.provider || "provider"} · ${item.model || "default"}]\n${text}`);
  }
  if (prior.length) parts.push(`Полезные результаты команды:\n${prior.slice(-MAX_OUTPUTS).join("\n\n")}`);
  if (acceptanceCriteria) parts.push(`Критерии готовности:\n${compact(acceptanceCriteria, 1_000)}`);

  return compact(parts.join("\n\n"), limit);
}
