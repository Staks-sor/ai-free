// Browser-only agent (Codex-style): Playwright tools, без файлов и shell.

import { formatSnapshotForPrompt } from "../browser/snapshot-build.mjs";
import { formatSearchPolicyHint } from "../browser/search-engine.mjs";

export const BROWSER_AGENT_PROMPT_VERSION = 2;

export const BROWSER_AGENT_TOOLS = [
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
  "ask_user",
  "finish",
];

export function createBrowserSystemPrompt(task, { browserContext = "" } = {}) {
  const browser = String(browserContext || "").trim();
  const browserSection = browser
    ? `\n=== BROWSER (live page) ===\n${browser}\n=== END BROWSER ===\n`
    : "";
  const searchPolicy = formatSearchPolicyHint(task);

  return `You are a web automation agent (Codex-style browser use).
Browser agent prompt version: ${BROWSER_AGENT_PROMPT_VERSION}
${browserSection}
${searchPolicy}

You control a real Playwright browser — the same session as the embedded Web panel (🧠 → Browser → Web).
Profile: ~/.deepseek-cli/web-browser-profile

Available tools (JSON only, one per turn):
${BROWSER_AGENT_TOOLS.filter((t) => t !== "finish" && t !== "ask_user").join(", ")}, finish, ask_user

Workflow (always):
1. browser_navigate — for search/news use yandex.ru or duckduckgo.com URL with encoded query (NOT Google)
2. browser_snapshot — read refs (e1, e2…), tree, visible text
3. browser_click / browser_type / browser_scroll / browser_key by ref from snapshot
4. browser_snapshot again to verify
5. finish with a short factual summary

Examples:
{"tool":"browser_navigate","url":"https://yandex.ru/search/?text=%D0%9C%D1%83%D1%80%D0%BC%D0%B0%D0%BD%D1%81%D0%BA%20%D0%BD%D0%BE%D0%B2%D0%BE%D1%81%D1%82%D0%B8"}
{"tool":"browser_navigate","url":"https://duckduckgo.com/?q=murmansk+news"}
{"tool":"browser_click","ref":"e3"}
{"tool":"browser_click","text":"Accept all"}
{"tool":"browser_type","ref":"e5","text":"query","clear":true}
{"tool":"browser_key","key":"Enter"}
{"tool":"browser_scroll","deltaY":600}
{"tool":"browser_wait","ms":1500}
{"tool":"browser_reset"}
{"tool":"finish","message":"summary"}

Rules:
- Reply with exactly one JSON object and no extra prose.
- Never use file tools, run_command, run_shell, delete_dir, write_file, or provider web search.
- Never fix the browser with npm install, package.json edits, or custom node/playwright scripts.
- If the browser is stuck or errors persist: browser_reset, then continue.
- Do not say you have no internet or cannot use the browser — tools run locally.
- Do not claim clicks, searches, or results without tool results in this session.
- If captchaHint appears in a tool result, switch to yandex.ru or duckduckgo.com immediately — never retry Google.
- For cookie/consent dialogs: snapshot first, then click by ref or visible text.
- Screenshot path: ~/.deepseek-cli/browser-cache/last-snapshot.jpg

User task:
${task}`;
}

export function formatBrowserContextForPrompt(snapshot) {
  return formatSnapshotForPrompt(snapshot);
}
