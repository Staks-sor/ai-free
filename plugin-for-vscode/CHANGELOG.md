# Changelog

## 0.1.33

- Fixed agent prompts that incorrectly told Qwen/DeepSeek to refuse current-news requests as "no internet".
- Pass provider web-search state into the code-agent system prompt.
- Kept local command restrictions scoped to command tools only, without disabling provider web search.

## 0.1.32

- Split Settings into side tabs: Language, API, and Permissions.
- Fixed DeepSeek web search by automatically loading `hif_leim_cached` from the saved browser profile and sending it as `x-hif-leim`.
- Persisted DeepSeek feature tokens during login/refresh so search keeps working after restart.
- Enabled provider web search for Qwen agent mode when the search toggle/default is active.

## 0.1.31

- Added a visible Anthropic-compatible API block in Settings for desktop and VS Code webview.
- Exposed `/v1/messages` URL and Anthropic auth header guidance next to provider API keys.
- Enabled Anthropic CORS headers for `x-api-key`, `anthropic-version`, and `anthropic-beta`.
- Passed smart-search intent through desktop, VS Code webview, and compatible API prompts so current/news requests use provider web search instead of falling back to "no internet access".

## 0.1.29

- Added visible language selection in Settings for both desktop and VS Code webview.
- Persisted UI language and smart-search defaults in `~/.deepseek-cli/settings.json`.
- Enabled smart search by default for fresh UI sessions so provider web search works without hidden environment flags.

## 0.1.28

- Added localized UI strings with language selection through environment locale / `AI_FREE_LANG`.
- Added Anthropic-compatible `/v1/messages` API support.
- Fixed OpenAI-compatible streaming tool-call termination with `finish_reason: "tool_calls"`.
- Restored native provider web search for API clients via `search`, `web_search`, `web_search_options`, or web-search tools.

## 0.1.14

- Added a Qwen browser-transport retry when Chromium `fetch` fails before receiving an HTTP response.
- Added Qwen request-failure diagnostics to make `Failed to fetch` reports actionable.
- Increased Qwen SPA initialization waits on cold or slow starts.

## 0.1.10

- Added support details to the Marketplace description.

## 0.1.11

- Added safer VS Code startup diagnostics for Windows users.
- Added Node.js 18+ preflight validation before spawning the local server.
- Disabled dependency auto-install bootstrap inside the packaged VS Code extension.
- Terminate the background server process if startup times out.
- Start the VS Code webview without forcing DeepSeek auth during activation.
- Automatically install the Playwright Chromium browser when it is missing.

## 0.1.12

- Fixed a Windows startup race where the server printed `Workspace server` but the extension still killed it after the port probe timed out.
- Increased VS Code server startup detection timeout to 30 seconds.

## 0.1.13

- Fixed duplicate sends while an agent task is already running.
- Stopped writing the "agent is already running" notice into chat history.
- Added stale running-task cleanup so a stuck task does not block an agent forever.

## 0.1.8

- Added per-workspace agents and active chat selection.
- Made VS Code workspace detection explicit and logged it to the `AI Free` output channel.
- Switched the sidebar to agent-first mode for VS Code projects.
- Fixed provider model selection so Qwen and DeepSeek use the selected model for new upstream sessions.
- Added a shared model catalog for UI and API model lists.
