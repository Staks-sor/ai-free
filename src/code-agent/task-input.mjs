// Парсинг slash-команд /code и /skill для code-agent.

export function parseAgentTaskPrompt(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return null;

  const skillMatch = text.match(/^\/skill\s+([a-z0-9_-]+)(?:\s+(.*))?$/i);
  if (skillMatch) {
    const task = (skillMatch[2] || "").trim();
    return {
      mode: "code",
      skillId: skillMatch[1],
      task,
      empty: !task,
    };
  }

  if (text === "/code" || text.startsWith("/code ")) {
    const task = text.slice(5).trim();
    return {
      mode: "code",
      skillId: null,
      task,
      empty: !task,
    };
  }

  return null;
}

export function resolveAgentTaskInput(prompt, {
  skillId = null,
  coderMode = false,
  hardwareMode = false,
  autoCodeMode = false,
  autoBrowserMode = false,
} = {}) {
  const parsed = parseAgentTaskPrompt(prompt);
  if (parsed) {
    return {
      run: true,
      task: parsed.task,
      skillId: parsed.skillId || skillId || null,
      empty: parsed.empty,
      slash: true,
      browserOnly: false,
    };
  }

  if (coderMode || hardwareMode || autoCodeMode || autoBrowserMode) {
    return {
      run: true,
      task: prompt,
      skillId: skillId || null,
      empty: !String(prompt || "").trim(),
      slash: false,
      browserOnly: autoBrowserMode && !coderMode && !hardwareMode,
    };
  }

  return { run: false, browserOnly: false };
}
