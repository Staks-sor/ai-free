const object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const string = (description) => ({ type: "string", description });
const integer = (description) => ({ type: "integer", description });
const boolean = (description) => ({ type: "boolean", description });

const definitions = [
  ["list_files", "List files and directories in the workspace.", object({ path: string("Relative path"), maxDepth: integer("Maximum depth"), maxEntries: integer("Maximum entries") }, ["path"])],
  ["read_file", "Read a UTF-8 text file from the workspace.", object({ path: string("Relative file path"), maxBytes: integer("Maximum bytes") }, ["path"])],
  ["write_file", "Create or replace a text file.", object({ path: string("Relative file path"), content: string("Complete file content") }, ["path", "content"])],
  ["append_file", "Append text to a file.", object({ path: string("Relative file path"), content: string("Text to append") }, ["path", "content"])],
  ["delete_file", "Delete one file.", object({ path: string("Relative file path") }, ["path"])],
  ["delete_dir", "Delete one directory recursively.", object({ path: string("Relative directory path") }, ["path"])],
  ["mkdir", "Create a directory.", object({ path: string("Relative directory path") }, ["path"])],
  ["run_command", "Run one allowed executable without a shell.", object({ cmd: string("Executable"), args: { type: "array", items: { type: "string" } }, timeoutMs: integer("Timeout milliseconds") }, ["cmd", "args"])],
  ["run_shell", "Run an allowed shell command or pipeline.", object({ command: string("Shell command"), timeoutMs: integer("Timeout milliseconds") }, ["command"])],
  ["list_serial_ports", "List connected serial ports.", object({})],
  ["github_status", "Inspect repository and GitHub authentication status.", object({})],
  ["github_repo", "Read GitHub repository metadata.", object({})],
  ["github_issues", "List GitHub issues.", object({ state: { type: "string", enum: ["open", "closed", "all"] }, limit: integer("Maximum issues") })],
  ["github_create_issue", "Create a GitHub issue.", object({ title: string("Issue title"), body: string("Issue body"), labels: { type: "array", items: { type: "string" } } }, ["title"])],
  ["ask_user", "Ask the user for a required decision.", object({ question: string("Question"), details: string("Context"), choices: { type: "array", items: { type: "string" } } }, ["question"])],
  ["browser_snapshot", "Read the current managed browser page.", object({ maxTextChars: integer("Maximum text characters"), includeScreenshot: boolean("Include screenshot") })],
  ["browser_navigate", "Navigate the managed browser.", object({ url: string("URL") }, ["url"])],
  ["browser_click", "Click by ref, text, selector, or coordinates.", object({ ref: string("Snapshot ref"), text: string("Visible text"), selector: string("CSS selector"), x: integer("X coordinate"), y: integer("Y coordinate") })],
  ["browser_type", "Type into a browser field.", object({ ref: string("Snapshot ref"), text: string("Text"), clear: boolean("Replace existing value") }, ["text"])],
  ["browser_key", "Press a browser key.", object({ key: string("Key name") }, ["key"])],
  ["browser_scroll", "Scroll the browser page.", object({ deltaY: integer("Vertical pixels") }, ["deltaY"])],
  ["browser_wait", "Wait for the browser page.", object({ ms: integer("Milliseconds") }, ["ms"])],
  ["browser_go_back", "Navigate back.", object({})],
  ["browser_list_tabs", "List managed browser tabs.", object({})],
  ["browser_switch_tab", "Switch browser tab.", object({ index: integer("Tab index") }, ["index"])],
  ["browser_reset", "Reset the managed browser when it is stuck.", object({})],
  ["finish", "Finish the task with a concise user-facing summary.", object({ message: string("Final response") }, ["message"])],
];

export const NATIVE_CODE_TOOLS = definitions.map(([name, description, parameters]) => ({
  type: "function",
  function: { name, description, parameters },
}));

export function createNativeCodeSystemPrompt(workspaceRoot, options = {}) {
  const context = [
    formatContextSection("Recent conversation", options.conversationContext),
    formatContextSection("Project instructions (AGENTS.md; nested scopes override parents)", options.projectInstructionsContext),
    formatContextSection("Relevant long-term memory (compressed)", options.memoryContext),
    formatContextSection("Active skill", options.skillPrompt),
    formatContextSection("Browser state", options.browserContext),
  ].filter(Boolean).join("\n\n");
  return `You are an autonomous coding agent operating on the user's local workspace.
Workspace root: ${workspaceRoot}
Use the provided tools to inspect and change the project. Start working immediately; do not merely propose future work.
Use only relative workspace paths. Inspect existing files before editing. Never claim a change or command result without a successful tool result.
Keep edits focused, run relevant checks, and call finish only when the task is actually complete.
Minimize API turns: batch related read-only file inspections and diagnostics into one run_shell call when safe, and never read the same unchanged file twice.
Browser tools are for explicit page interaction or parsing, not ordinary knowledge questions.
If a required choice is genuinely ambiguous, use ask_user.
${context ? `Additional project context:\n${context}` : ""}`.trim();
}

function formatContextSection(title, content) {
  const value = String(content || "").trim();
  return value ? `${title}:\n${value}` : "";
}
