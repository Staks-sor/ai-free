# AI Free 0.4.3

AI Free 0.4.3 keeps the desktop application, CLI/API and VS Code extension on one synchronized release.

## Qwen reliability

- Handles Qwen's temporary `The chat is in progress` response without immediately resetting the browser transport.
- Uses one strict recovery attempt when Qwen returns prose instead of a workspace tool call, reducing wasted web-chat requests.
- Disables provider search during tool-call recovery so search output cannot replace local agent execution.
- Reads search support from the live Qwen model catalog before enabling smart search.
- Adds Qwen3.8 Max Preview and keeps Qwen3.7 Max usable when smart search is enabled globally.

## Agent and release safeguards

- Keeps desktop and VS Code Qwen clients, adapters, model synchronization and code-agent loops aligned through CI invariants.
- Adds focused tests for Qwen model capabilities, stream errors and tool-call recovery.
- Preserves the same `0.4.3` version across desktop, CLI/API and the VS Code extension.

## Versions

- Desktop, CLI and compatible APIs: `0.4.3`
- VS Code extension: `0.4.3`
- Release tag: `v0.4.3`
