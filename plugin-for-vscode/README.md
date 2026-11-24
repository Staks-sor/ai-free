# SYNVOX — AI Chat & Agent

SYNVOX brings DeepSeek, Qwen, ChatGPT, Google AI Mode and GLM into the VS Code sidebar as project-aware coding agents.

Current release: **0.5.65**.

## Access

SYNVOX is free for personal use with no trial, activation, or subscription. Sign in to the AI providers you use. Their policies, availability and limits apply separately.

Open **Settings → Accounts** to manage Qwen accounts and automatic switching when a supported quota response is detected. Other providers do not currently support this automatic account rotation.

[Installation instructions](https://synvox.pro/instructions/) · [Terms, privacy and refunds](https://synvox.pro/documents/)

## Features

- DeepSeek and Qwen providers.
- Agent-first workflow for the currently opened VS Code workspace.
- Hierarchical `AGENTS.md` project instructions, reloaded before every agent task.
- Separate agents and chat history per project.
- Model picker with current DeepSeek and Qwen model aliases.
- Local server bridge bundled with the extension.

## Requirements

- Qwen/DeepSeek browser sign-in requires Python 3.10+ from [python.org](https://www.python.org/downloads/), available in PATH (restart the IDE after installation). Camoufox and its browser download once from PyPI/GitHub. Settings → Accounts shows preparation progress and actionable errors. Interactive Linux/WSL/SSH sign-in requires a graphical display (WSLg/X11).

- Current VS Code or Cursor. The extension uses the IDE's bundled Node.js runtime when compatible and falls back to Node.js 22+ from `PATH`.
- Existing AI Free authentication state for the providers you use.
- Qwen login can be prepared from the main AI Free app with `npm run login-qwen`.

## Notes

The extension stores existing provider sessions in the same local AI Free storage as the main app. It does not rename or migrate `~/.deepseek-cli` or `~/.qwen-cli`.

## Detailed logs

The extension writes privacy-safe JSONL diagnostics to `%USERPROFILE%\.ai-free\logs\ai-free.log` on Windows and `~/.ai-free/logs/ai-free.log` on macOS/Linux. It records process lifecycle, HTTP status and timing, provider/model selection, retries, background tasks, tool calls and full error stack traces. Prompts and responses are not persisted, and credentials are redacted. Rotation defaults to five files of 5 MiB each.

## Uninstall

To remove only the VS Code extension:

1. Open **Extensions** in VS Code.
2. Find **SYNVOX — AI Chat & Agent**.
3. Click **Uninstall**.
4. Restart VS Code.

Or run:

```bash
code --uninstall-extension developers-daily-life.ai-free-vscode
```

The extension uses the same local data as the desktop app. To fully remove chats, auth sessions, browser profiles, memory and skills, delete these folders after uninstalling the extension:

```bash
# macOS / Linux
rm -rf ~/.deepseek-cli ~/.qwen-cli ~/.chatgpt-cli ~/.ai-free
```

```powershell
# Windows PowerShell
Remove-Item -Recurse -Force `
  "$env:USERPROFILE\.deepseek-cli", `
  "$env:USERPROFILE\.qwen-cli", `
  "$env:USERPROFILE\.chatgpt-cli", `
  "$env:USERPROFILE\.ai-free"
```

See the root README for the full desktop and plugin removal guide.

## Support

See the [SYNVOX website](https://synvox.pro/) for installation instructions and support.

## Repository

Source code: https://github.com/Staks-sor/ai-free
