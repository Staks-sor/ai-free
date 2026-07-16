# EconomyOS integration showcase draft

## Project

- Name: AI Free
- Repository: https://github.com/Staks-sor/ai-free
- Integration: EconomyOS Agent Compute by Virtuals
- Platforms: desktop application and VS Code extension
- License: open source; see the repository for current license terms

## What the integration does

AI Free exposes EconomyOS as an optional model provider alongside its other providers. After connecting an EconomyOS API key, a user can:

- create regular EconomyOS chats;
- stream responses in the desktop app and VS Code extension;
- use EconomyOS in workspace-aware code-agent flows;
- call EconomyOS through AI Free's local OpenAI-compatible, Responses-compatible, and Anthropic-compatible endpoints;
- combine EconomyOS inference with AI Free's local tools and browser workflows.

The implementation uses the documented EconomyOS Agent Compute contract:

- base URL: `https://compute.virtuals.io/v1`;
- endpoint: `POST /chat/completions`;
- authentication: `Authorization: Bearer <VIRTUALS_API_KEY>`;
- model catalog: `GET /models`, loaded for the connected user;
- fallback model: `z-ai-glm-4-7-flash`.

## Credits and key ownership

AI Free uses a strict bring-your-own-key model. It does not bundle, proxy, download, or distribute the maintainer's EconomyOS key or developer credits.

Each user:

1. opens the Virtuals agent portal;
2. links their own GitHub account and claims credits if eligible;
3. obtains their own EconomyOS API key;
4. enters that key locally in **Settings -> API -> EconomyOS by Virtuals**.

The key is stored in the user's local AI Free settings file with restrictive file permissions, is never returned by the settings API, and is sent only to the fixed official EconomyOS Compute endpoint. Advanced users can provide it through `VIRTUALS_API_KEY` instead of storing it.

## Suggested demo

1. Open AI Free desktop or the VS Code extension.
2. Open **Settings -> API -> EconomyOS by Virtuals**.
3. Connect a test API key locally. Do not show the key on screen.
4. Create an EconomyOS chat and send a short prompt.
5. Show the streamed response.
6. Open a small test workspace and run an EconomyOS code-agent request.
7. Show the changed file and the local tool log.
8. Disconnect EconomyOS and show that AI Free asks for the user's own key instead of falling back to a shared project key.

Recommended recording length: 60-90 seconds. Blur account identifiers, balances, API keys, and local private paths.

## Evidence in the repository

- Integration and security notes: `docs/ECONOMYOS_INTEGRATION.md`
- Provider client: `src/providers/economyos/client.mjs`
- Local settings and environment support: `src/state/settings.mjs`
- Desktop server integration: `src/window-app/server.mjs`
- Desktop settings UI: `src/window-app/ui-html.mjs`
- VS Code equivalents: `plugin-for-vscode/src/`
- Automated provider tests: `test/economyos-client.test.mjs`

## Message to the EconomyOS team

Hello EconomyOS team,

Thank you for approving AI Free for the developer credits program. We have implemented EconomyOS Agent Compute as an optional provider in both the AI Free desktop app and VS Code extension, using the official `https://compute.virtuals.io/v1/chat/completions` endpoint.

The integration is strictly bring-your-own-key: every AI Free user connects their own Virtuals agent API key and uses their own credits. The project does not distribute or proxy the maintainer's credits. The key remains local and requests go directly from the user's AI Free runtime to the official EconomyOS endpoint.

The integration supports streaming chat, workspace-aware code-agent workflows, and AI Free's local compatibility APIs. We are preparing a short demo and would be glad to submit the project to the public showcase.

One detail needs your guidance: the current `showcase.json` schema in `Virtual-Protocol/acp-cli-demos` lists `wallet`, `email`, `card`, `token`, and `acp` as valid primitives, but AI Free currently integrates the Agent Compute API. Should we submit this as a new `compute` primitive, use another official primitive value, or follow a different showcase path for Compute integrations? We do not want to label the integration as ACP unless that is the intended classification.

Repository: https://github.com/Staks-sor/ai-free

Best regards,
Staks / AI Free

## Submission status

Do not submit a showcase pull request until:

- a real request has been verified with a locally connected test key;
- the public release containing the integration is available;
- a demo URL or media file exists;
- EconomyOS confirms the correct primitive/classification for Agent Compute.
