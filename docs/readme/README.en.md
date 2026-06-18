# AI Free

[<kbd>Русский</kbd>](../../README.md) [<kbd>English</kbd>](README.en.md) [<kbd>Español</kbd>](README.es.md) [<kbd>Português</kbd>](README.pt.md) [<kbd>Deutsch</kbd>](README.de.md) [<kbd>Français</kbd>](README.fr.md) [<kbd>中文</kbd>](README.zh.md) [<kbd>हिन्दी</kbd>](README.hi.md) [<kbd>العربية</kbd>](README.ar.md)

> A CLI and desktop app that brings free AI web chats into one interface. Currently supports **DeepSeek, Qwen, and ChatGPT**. Runs on macOS, Linux, and Windows.

## Support the project

If AI Free saves you time, please [star the repository](https://github.com/Staks-sor/ai-free). It helps other people discover the project.

- Donation card (OTP Bank): `2201 9604 2500 7505`

## Features

- DeepSeek, Qwen, and ChatGPT conversations in one desktop window.
- Automatic browser login and session recovery for each provider.
- Multiple chats, each connected to its own project folder.
- A `/code` agent with workspace file access and an allowlist of commands.
- Long-term agent memory, a memory graph, and reusable skills.
- OpenAI-compatible and Anthropic-compatible local APIs for IDE integrations.
- Optional multilingual Parakeet V3 voice input, downloaded only when first used.
- Configurable language, API, permissions, and agent settings.

## Requirements

- Node.js 18 or newer.
- npm.
- Internet access for AI providers and the initial Chromium installation.
- On Linux, Chromium system dependencies may also be required.

## Installation

### macOS and Linux

```bash
git clone https://github.com/Staks-sor/ai-free.git
cd ai-free
npm install
npm start
```

On Linux:

```bash
sudo npx playwright install-deps chromium
```

### Windows

```powershell
git clone https://github.com/Staks-sor/ai-free.git
cd ai-free
npm install
npm start
```

During the first launch, select the providers you want to connect and sign in through the browser window. Sessions are stored locally and reused on later launches.

## Main commands

| Command | Purpose |
|---|---|
| `npm start` | Start the desktop chat window |
| `npm run cli` | Start the terminal REPL |
| `npm run api` | Start the local compatible API on `127.0.0.1:4318` |
| `npm run login` | Sign in to DeepSeek again |
| `npm run login-qwen` | Sign in to Qwen again |
| `npm run login-chatgpt` | Sign in to ChatGPT again |
| `npm test` | Run the test suite |

## Local API

Start the API server:

```bash
npm run api
```

OpenAI-compatible base URL:

```text
http://127.0.0.1:4318/v1
```

API keys and provider-specific settings are available in the app under **Settings → API**.

## Project workspaces

When creating a chat, choose a project folder. Code-agent tools in that chat operate only inside the selected workspace. Recent folders remain available for quick selection.

## Memory and skills

- **Coder** sends tasks directly to the code agent.
- **Memory** retrieves relevant previous fixes and stores useful outcomes.
- **Skill auto** selects a skill based on the task.
- `/skill <id> <task>` selects a skill manually.

Detailed architecture: [AI Free Brains and Skills Plan](../AI_FREE_BRAINS_AND_SKILLS_PLAN.md).

## Local data

Provider sessions and settings are stored outside the repository:

- DeepSeek and shared chat state: `~/.deepseek-cli/`
- Qwen: `~/.qwen-cli/`
- Memory and user skills: `~/.ai-free/`

Tokens and cookies remain on the local machine. The chat and API servers listen on `127.0.0.1`.

## Troubleshooting

- Reconnect DeepSeek with `npm run login`.
- Reconnect Qwen with `npm run login-qwen`.
- Reconnect ChatGPT with `npm run login-chatgpt`.
- If Playwright Chromium is missing, run `npx playwright install chromium`.
- On Linux, run `sudo npx playwright install-deps chromium` if browser libraries are missing.

## Feedback and license

Found a bug or have an idea? [Open an issue](https://github.com/Staks-sor/ai-free/issues).

Personal-Use-Only. See [LICENSE](../../LICENSE).
