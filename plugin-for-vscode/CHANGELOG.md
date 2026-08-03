# Changelog

## 0.4.18

- Adds the EconomyOS API-credit giveaway banner and participation flow.
- Opens the giveaway on startup with an attention sound and keeps it available in the sidebar.
- Links the participation action to the dedicated AI Free raffle page.
- Shows the 22:00 MSK participation deadline and 23:00 MSK YouTube result time.
- Restores workspace write-tool recovery when a model incorrectly claims that tools are unavailable.
- Preserves memory and project instructions in compact agent follow-up prompts.
- Improves ChatGPT composer and login recovery without repeating the full startup timeout.
- Keeps the giveaway UI and release version synchronized across desktop and VS Code.

## 0.4.14

- Replaces fragile ChatGPT timing loops with generation-aware DOM observation for long tasks.
- Preserves ChatGPT progress across temporary observer failures and waits up to 30 minutes when generation is still active.
- Fixes Windows npm discovery for GUI launches, MSI installs and common Node.js version managers.
- Adds safe `.NET` diagnostics commands and localized `dotnet` permission descriptions.
- Removes stale permission overlays that could block sending and chat switching after a long task.
- Prevents an old stopped background task from clearing the state of its replacement.
- Keeps all fixes synchronized across desktop and VS Code.

## 0.4.13

- Reuses persistent DeepSeek, Qwen and ChatGPT code-agent context with compact JSON follow-up prompts.
- Preserves late user clarifications before accepting a stale final answer or `finish` call.
- Adds task-level trace IDs and lifecycle events to persistent diagnostics.
- Keeps the embedded ChatGPT/Camoufox session alive and periodically checkpoints refreshed browser state.
- Recovers from replaced, disabled or detached ChatGPT composer elements.
- Detects visible generation errors and start timeouts without resubmitting a prompt that was already sent.
- Excludes internal tests and local development artifacts from client release packages.
- Synchronizes all behavior across desktop and VS Code and adds the current desktop screenshot to GitHub documentation.

## 0.4.11

- Fixed OpenAI-compatible streams ending successfully without text or tool calls.
- Retries one empty DeepSeek stream on a fresh session before returning an explicit error.
- Preserves final DeepSeek SSE events even when the upstream omits the trailing blank line.
- Maps tool results back to names by `tool_call_id` and normalizes common edit-argument aliases.
- Prevents agents from repeating invalid tool calls or no-op writes and from deferring available edits to the user.
- Added privacy-safe persistent JSONL diagnostics for desktop and VS Code.
- Rebuilt the light theme with distinct navigation, content, modal and composer surfaces.
- Added hierarchical `AGENTS.md` project instructions with nested directory scopes.
- Reloads project instructions before every agent task without storing stale copies in long-term memory.
- Applies the same agent context and theme implementation to desktop and VS Code.

## 0.4.9

- Fixed Qwen responses becoming duplicated or interleaved when one SSE request contains multiple `response_id` streams.
- Selects Qwen's primary `response_index: 0` result instead of concatenating alternate response candidates.
- Applies the same response selection to incremental streaming, buffered SSE and direct stream parsing.
- Added regression coverage based on the response structure reported in GitHub issue #13.

## 0.4.8

- Fixed Windows Node.js/npm discovery when AI Free is launched from a GUI with a restricted `PATH`.
- Unified diagnostics and updater command resolution so an npm installation detected by Status is also used for updates.
- Added standard MSI, `%APPDATA%`, `%LOCALAPPDATA%` and running-Node fallback paths for `npm.cmd`.
- Reworked ChatGPT authorization into a verified one-time Chrome login followed by a persistent hidden Camoufox session.
- Rejected stale ChatGPT sessions containing `RefreshAccessTokenError` instead of reporting a false successful login.
- Preserved exact OAuth cookie domains, login popups and session state across desktop and VS Code.
- Prevented closing the authorization window from terminating the AI Free process.

## 0.4.6

- Fixed the packaged extension failing at startup because `diagnostics.mjs` was missing from the VSIX.
- Fixed Windows startup when `node.exe` in `PATH` is missing, slow or shadowed by another command.
- The extension now prefers the compatible Node.js runtime bundled with VS Code or Cursor and falls back to Node.js 18+ from `PATH`.
- Added build-time server import validation and runtime-selection tests so incomplete VSIX builds cannot pass CI.
- Preserved the dedicated ChatGPT browser profile across normal re-authorization.

## 0.4.5

- Made Qwen recover from stuck `The chat is in progress` turns by continuing in a fresh chat.
- Improved ChatGPT Auth.js session-cookie compatibility and expired-token handling.
- Serialized EconomyOS completions to reduce concurrent request bursts and HTTP 429 errors.
- Added opt-in permissions for additional local scripting commands.
- Kept desktop and VS Code provider, agent and settings behavior synchronized.

## 0.4.3

- Fixed Qwen code-agent recovery when the model responds without workspace tool calls.
- Reduced wasted Qwen web requests and handled the temporary `The chat is in progress` state.
- Synced Qwen search capabilities with the live model catalog and added Qwen3.8 Max Preview.
- Kept desktop and VS Code provider, agent and model behavior synchronized.

## 0.4.0

- Added EconomyOS as a BYOK provider with selectable Virtuals Compute models.
- Added native agent tool calls, resumable checkpoints, persistent chat images and improved memory context.
- Added a resilient cached EconomyOS model catalog with desktop and VS Code parity.

## 0.3.15

- Improved Windows startup diagnostics and Chromium binary checks.
- Reduced Qwen browser startup and navigation latency with background warm-up.
- Removed the desktop Git updater from the extension; VS Code Marketplace handles extension updates.
- Synced the VIBE sidebar offer and details dialog with desktop, without popup advertising.
- Fixed provider authorization buttons on older Chromium/Windows 10 and surfaced background login errors.
- Removed Telegram UI and bot polling from the extension; Telegram remains desktop-only.

## 0.1.41

- Prevented STT install tests from writing fake runtimes into the user's real `~/.deepseek-cli` directory.
- Made the generated Parakeet shim recover when a saved binary path disappears by falling back to `command -v parakeet`.
- Treats the managed Voice runtime as missing when the shim exists but the real `parakeet` binary is unavailable, so clicking Voice can reinstall it.
- Added a Windows `.cmd` Voice launcher and executable lookup for `.exe/.cmd/.bat`.
- Disables Cargo HTTP/2 multiplexing and enables retries during Parakeet install to reduce transient network failures.

## 0.1.40

- Fixed Voice auto-install stopping when Homebrew terminates without a normal exit code.
- Falls back to Cargo when Homebrew cannot install `parakeet-cli`.
- Shows clearer install failures for terminated STT installer processes.

## 0.1.39

- Fixed deleted chats coming back after restart when old workspace state files were still present.
- Added deletion tombstones to the shared desktop/VS Code state migration path.
- Cleans active chat and pipeline references when a conversation is deleted.

## 0.1.38

- Changed first Voice click to automatically install Parakeet V3 support when missing.
- Uses `parakeet-cli` as the lightweight native runtime: Homebrew on macOS when available, Cargo as fallback.
- Downloads the Parakeet V3 INT8 model into `~/.deepseek-cli/stt/models` instead of bundling it with the extension.
- Records microphone audio as WAV before transcription, matching Parakeet file transcription requirements.
- Reworked the Voice settings status card so long runtime paths no longer overlap the status badge.

## 0.1.37

- Added a lightweight voice input integration for desktop and VS Code webviews.
- Added microphone recording in the composer; transcripts are inserted into the message box for review before sending.
- Added local `/api/voice/status` and `/api/voice/transcribe` endpoints.
- Added optional Parakeet V3 helper discovery through `~/.deepseek-cli/stt/runtime/ai-free-stt` or `AI_FREE_STT_BIN`, without bundling any model/runtime into the extension.
- Added Voice input status in Settings and localization for all bundled UI languages.

## 0.1.36

- Completed bundled UI translations so every supported language has the full Settings, API, Permissions, chat, file, pipeline, and welcome string set.
- Changed non-Russian fallback text to English only, preventing missing translations from showing Russian in English/Spanish/Portuguese/etc.
- Localized pipeline role labels and descriptions returned by `/api/agent-roles`.
- Localized remaining hardcoded webview labels such as Home, History, Coder/Pipeline toggles, and upload errors.

## 0.1.35

- Removed the Settings hint paragraph above the side tabs.
- Made Permissions descriptions translate client-side from the selected UI language, avoiding stale Russian text from older server responses.

## 0.1.34

- Localized Settings/API labels for all bundled UI languages.
- Localized command descriptions in the Permissions tab instead of always showing Russian text.
- Changed non-Russian fallback text to English before Russian so incomplete translations no longer mix heavily with Russian.

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
