// Ограничение tools по skill.commands из манифеста.

const ALWAYS_ALLOWED = new Set([
  "finish",
  "ask_user",
  "browser_snapshot",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_key",
  "browser_scroll",
  "browser_wait",
  "browser_go_back",
  "browser_list_tabs",
  "browser_switch_tab",
  "browser_reset",
]);

export function getAllowedTools(skill) {
  if (!skill?.commands?.length) return null;
  return skill.commands;
}

export function isToolAllowed(toolName, allowedTools) {
  const tool = String(toolName || "").trim();
  if (!tool) return false;
  if (ALWAYS_ALLOWED.has(tool)) return true;
  if (!Array.isArray(allowedTools) || !allowedTools.length) return true;
  return allowedTools.includes(tool);
}

export function formatAllowedToolsHint(allowedTools) {
  if (!Array.isArray(allowedTools) || !allowedTools.length) return "";
  return `Active skill restricts tools to: ${allowedTools.join(", ")} (+ finish, ask_user).`;
}
