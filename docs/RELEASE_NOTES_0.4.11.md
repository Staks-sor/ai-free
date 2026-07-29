# AI Free 0.4.11

AI Free 0.4.11 improves the light interface and adds project-native agent instructions to desktop and VS Code.

## OpenAI-compatible agent stability

- Empty DeepSeek streams are retried once on a fresh session before returning an explicit error.
- The final DeepSeek SSE frame is parsed even when it has no trailing blank line.
- Every successful stream now contains text or tool calls and a terminal `finish_reason` chunk.
- Tool results are mapped back through `tool_call_id`, so validation failures retain the correct tool name.
- Common edit argument aliases are normalized to the client schema, including `newText` and `new_string`.
- Agent prompts explicitly correct missing required arguments, stop repeating no-op writes and execute available edits instead of asking the user to do them manually.

## Diagnostics

- Desktop and VS Code write privacy-safe JSONL logs to `~/.ai-free/logs/ai-free.log` or `%USERPROFILE%\\.ai-free\\logs\\ai-free.log`.
- Logs include provider attempts, HTTP statuses, timings, retries, background tasks, tools and error stack traces without prompt text or credentials.

## Light theme

- Separates navigation, top bar, chat canvas, cards and composer into readable light surfaces.
- Removes hard-coded dark modal, hover, log and provider-card backgrounds.
- Uses theme-aware accent text, borders, scrollbars, overlays and shadows.
- Keeps the desktop and VS Code styles synchronized.

## Project instructions

- Loads root and nested `AGENTS.md` files before every code-agent task.
- Applies the root file to the whole workspace and nested files to their directory trees.
- Gives deeper instructions precedence when scopes overlap.
- Excludes dependencies, generated output, caches and version-control directories.
- Keeps `AGENTS.md` separate from long-term memory so current project rules are never replaced by stale saved context.
- Supports both native API tool calls and the text-based agent tool loop.

## Verification

- Added regression tests for theme surface hierarchy and `AGENTS.md` discovery, scoping and prompt injection.
- Desktop, CLI and compatible APIs: `0.4.11`
- VS Code extension: `0.4.11`
- Release tag: `v0.4.11`
