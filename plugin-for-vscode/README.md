# AI Free Chat & Agent

AI Free brings DeepSeek, Qwen, ChatGPT and optional EconomyOS by Virtuals into the VS Code sidebar as project-aware coding agents.

Current release: **0.4.8**.

## Features

- DeepSeek and Qwen providers.
- Agent-first workflow for the currently opened VS Code workspace.
- EconomyOS BYOK integration with selectable Virtuals Compute models and no shared project key.
- Separate agents and chat history per project.
- Model picker with current DeepSeek and Qwen model aliases.
- Local server bridge bundled with the extension.

## Requirements

- Current VS Code or Cursor. The extension uses the IDE's bundled Node.js runtime when compatible and falls back to Node.js 18+ from `PATH`.
- Existing AI Free authentication state for the providers you use.
- Qwen login can be prepared from the main AI Free app with `npm run login-qwen`.

## Notes

The extension stores existing provider sessions in the same local AI Free storage as the main app. It does not rename or migrate `~/.deepseek-cli` or `~/.qwen-cli`.

## Uninstall

To remove only the VS Code extension:

1. Open **Extensions** in VS Code.
2. Find **AI Free Chat & Agent**.
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

Если хочешь поддержать мое развитие:

`2201 9604 2500 7505` ОТП банк

## Repository

Source code: https://github.com/Staks-sor/ai-free
