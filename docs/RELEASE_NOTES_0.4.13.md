# AI Free 0.4.13

AI Free 0.4.13 improves long-running agent continuity, ChatGPT browser reliability and release packaging in desktop and VS Code.

![AI Free 0.4.13 desktop agent](https://raw.githubusercontent.com/Staks-sor/ai-free/v0.4.13/docs/assets/ai-free-agent-0.4.13.png)

## Compact persistent agent context

- DeepSeek, Qwen and ChatGPT receive the full code-agent setup once per new provider chain.
- Follow-up tasks reuse that persistent context and send a compact JSON task prompt.
- Providers without confirmed persistent context retain the complete setup on every task.

## Reliable running tasks

- User clarifications received during generation are applied before a stale text answer or `finish` call is accepted.
- Immediately repeated clarifications are deduplicated in chat state.
- Background work records task trace IDs, lifecycle stages, duration and terminal status in persistent logs.

## ChatGPT and Camoufox

- Login stays inside AI Free and reuses the persistent embedded browser session.
- Browser storage and refreshed cookies are checkpointed while the app remains open.
- Composer input recovers when ChatGPT replaces, disables or detaches its textarea.
- Generation waiting distinguishes visible controls, page errors and start timeouts.
- A prompt is never automatically submitted twice after the first send succeeds.

## Packaging and parity

- Desktop and VS Code implementations remain synchronized.
- npm and VSIX release packages explicitly exclude tests, coverage and local development artifacts.
- The repository README includes the current desktop agent screenshot.

## Verification

- Desktop, CLI and compatible APIs: `0.4.13`
- VS Code extension: `0.4.13`
- Release tag: `v0.4.13`
