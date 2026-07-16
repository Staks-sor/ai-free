# AI Free 0.4.0

AI Free 0.4.0 is a synchronized release for the desktop application, CLI/API and VS Code extension.

## Highlights

- Added EconomyOS by Virtuals as an optional bring-your-own-key provider.
- Added selectable EconomyOS models with a cached live catalog and an offline fallback list.
- Added native API tool calls for EconomyOS code-agent workflows.
- Added resumable agent checkpoints so interrupted tasks can continue without repeating completed tools.
- Improved long-term memory context and compact conversation summaries.
- Added persistent chat images and EconomyOS vision processing.
- Added multilingual Parakeet V3 voice input with on-demand runtime installation.
- Added OpenAI-compatible and Anthropic-compatible local APIs.
- Improved browser tools and internet-enabled agent workflows.
- Kept desktop and VS Code behavior, model catalogs and EconomyOS clients synchronized.

## EconomyOS Credits

EconomyOS uses each user's own `VIRTUALS_API_KEY`. AI Free does not bundle or distribute a shared project key, so requests consume only the credits belonging to the connected Virtuals account.

## Versions

- Desktop, CLI and compatible APIs: `0.4.0`
- VS Code extension: `0.4.0`
- Release tag: `v0.4.0`

## Verification

- CI invariants validate synchronized package and lockfile versions.
- The complete Node.js test suite passes.
- The VS Code extension build and VSIX packaging pass.
