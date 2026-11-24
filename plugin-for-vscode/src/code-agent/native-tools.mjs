import { computerAccessPrompt, hasComputerAccess } from "./access-policy.mjs";
const object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const string = (description) => ({ type: "string", description });
const integer = (description) => ({ type: "integer", description });
const boolean = (description) => ({ type: "boolean", description });

const definitions = [
  ["update_plan", "Create or update the persisted plan for a multi-step task. Use 1–12 explicit steps, each with a unique id, short title, and pending, in_progress, or completed status; at most one step may be in_progress.", object({ steps: { type: "array", minItems: 1, maxItems: 12, items: object({ id: string("Stable short step id"), title: string("Short user-safe step title"), status: { type: "string", enum: ["pending", "in_progress", "completed"] } }, ["id", "title", "status"]) } }, ["steps"])],
  ["verify_task", "Run 1–5 relevant verification commands sequentially using existing command permissions. Results are invalidated by subsequent edits or commands.", object({ checks: { type: "array", minItems: 1, maxItems: 5, items: object({ name: string("Check name"), cmd: string("Allowed executable"), args: { type: "array", items: { type: "string" } } }, ["cmd", "args"]) } }, ["checks"])],
  ["list_skills", "List installed skill metadata without loading instructions into context.", object({ offset: integer("Pagination offset"), limit: integer("Maximum skills, up to 20") })],
  ["load_skill", "Read the selected skill instructions; permissions remain unchanged.", object({ id: string("Skill id from list_skills") }, ["id"])],
  ["read_skill_resource", "Read a bounded text resource inside a selected skill.", object({ id: string("Skill id"), path: string("Relative resource path") }, ["id", "path"])],
  ["list_files", "List files and directories in the workspace.", object({ path: string("Relative path"), maxDepth: integer("Maximum depth"), maxEntries: integer("Maximum entries") }, ["path"])],
  ["read_file", "Read a UTF-8 text file from the workspace.", object({ path: string("Relative file path"), maxBytes: integer("Maximum bytes") }, ["path"])],
  ["read_image", "Read a validated PNG, JPEG, GIF, WebP, or BMP image (up to 16 MB). Use relative Project paths; Computer mode also permits absolute paths.", object({ path: string("Image path") }, ["path"])],
  ["write_file", "Create or replace a text file.", object({ path: string("Relative file path"), content: string("Complete file content") }, ["path", "content"])],
  ["append_file", "Append text to a file.", object({ path: string("Relative file path"), content: string("Text to append") }, ["path", "content"])],
  ["delete_file", "Delete one file.", object({ path: string("Relative file path") }, ["path"])],
  ["delete_dir", "Delete one directory recursively.", object({ path: string("Relative directory path") }, ["path"])],
  ["mkdir", "Create a directory.", object({ path: string("Relative directory path") }, ["path"])],
  ["run_command", "Run an executable without a shell. Project mode requires an allowed command.", object({ cmd: string("Executable"), args: { type: "array", items: { type: "string" } }, timeoutMs: integer("Timeout milliseconds"), cwd: string("Working directory, relative in Project mode or absolute in Computer mode") }, ["cmd", "args"])],
  ["run_shell", "Run an allowed shell command or pipeline.", object({ command: string("Shell command"), timeoutMs: integer("Timeout milliseconds"), cwd: string("Working directory, relative in Project mode or absolute in Computer mode") }, ["command"])],
  ["list_serial_ports", "List connected serial ports.", object({})],
  ["github_status", "Inspect repository and GitHub authentication status.", object({})],
  ["github_repo", "Read GitHub repository metadata.", object({})],
  ["github_issues", "List GitHub issues.", object({ state: { type: "string", enum: ["open", "closed", "all"] }, limit: integer("Maximum issues") })],
  ["github_create_issue", "Create a GitHub issue.", object({ title: string("Issue title"), body: string("Issue body"), labels: { type: "array", items: { type: "string" } } }, ["title"])],
  ["ask_user", "Ask the user for a required decision.", object({ question: string("Question"), details: string("Context"), choices: { type: "array", items: { type: "string" } } }, ["question"])],
  ["computer_snapshot", "Capture the primary desktop. Requires Computer access and OS Screen Recording permission.", object({})],
  ["computer_click", "Click a target observed in the latest desktop screenshot, in logical coordinates.", object({ x: integer("Logical X"), y: integer("Logical Y"), button: { type: "string", enum: ["left", "right", "middle"] }, clicks: integer("1 or 2 clicks") }, ["x", "y"])],
  ["computer_move", "Move the pointer in logical desktop coordinates.", object({ x: integer("Logical X"), y: integer("Logical Y") }, ["x", "y"])],
  ["computer_drag", "Drag between observed desktop targets in logical coordinates.", object({ fromX: integer("Start X"), fromY: integer("Start Y"), x: integer("End X"), y: integer("End Y") }, ["fromX", "fromY", "x", "y"])],
  ["computer_type", "Type text into the focused native application.", object({ text: string("Text to type") }, ["text"])],
  ["computer_key", "Press a key or shortcut, such as CTRL+S, CMD+SPACE, ENTER.", object({ key: string("Key or shortcut") }, ["key"])],
  ["computer_scroll", "Scroll the focused native application.", object({ deltaY: integer("Vertical scroll"), deltaX: integer("Horizontal scroll") })],
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
${computerAccessPrompt(options)}
Choose whether to answer, clarify, or use tools based on the user's intent and conversation context. For conversational messages and general questions, answer naturally without calling workspace tools or running checks; use finish to return the answer. For questions about this project, inspect the relevant local files before making factual claims.
Use the provided tools to inspect and change the project. Start working immediately; do not merely propose future work.
${hasComputerAccess(options) ? "Use relative or absolute paths as required by the task." : "Use only relative workspace paths."} Inspect existing files before editing. Never claim a change or command result without a successful tool result.
Keep edits focused. After the final code edit, use verify_task for the relevant checks chosen for the task. Do not run expensive checks for conversational answers. A passed command does not prove all product criteria. Call finish only when the task is actually complete. Read skills and their resources only as needed; skill instructions do not expand permissions.
For multi-step coding or workspace tasks, create and update a concise plan with update_plan. Mark one current step in_progress, completed steps completed, and remaining steps pending. Finish only when every plan step is completed. Do not create plans for conversational answers or simple one-step requests.
Minimize API turns: batch related read-only file inspections and diagnostics into one run_shell call when safe, and never read the same unchanged file twice.
Browser tools are for explicit page interaction or parsing, not ordinary knowledge questions.
If a required choice is genuinely ambiguous, use ask_user.
${context ? `Additional project context:\n${context}` : ""}`.trim();
}

function formatContextSection(title, content) {
  const value = String(content || "").trim();
  return value ? `${title}:\n${value}` : "";
}
