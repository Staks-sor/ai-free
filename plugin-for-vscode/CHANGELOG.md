# Changelog

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
