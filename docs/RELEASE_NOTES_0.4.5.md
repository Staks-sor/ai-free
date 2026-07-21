# AI Free 0.4.5

AI Free 0.4.5 keeps the desktop application, CLI/API and VS Code extension on one synchronized release.

## Fixed

- Qwen code-agent tasks recover from stuck `The chat is in progress` turns by moving to a fresh chat and preserving that session for subsequent steps.
- ChatGPT authentication recognizes current Auth.js session cookies, including chunked cookies, and no longer treats expired JWT access tokens as valid.
- EconomyOS serializes simultaneous completions to reduce request bursts, wasted retries and HTTP 429 responses.

## Improved

- Added explicit, disabled-by-default permissions for additional local scripting commands.
- Improved pipeline leader restoration and controls in the desktop interface.
- Kept provider clients, agent behavior and settings synchronized between desktop and VS Code.

## Verification

- Desktop, CLI and compatible APIs: `0.4.5`
- VS Code extension: `0.4.5`
- Release tag: `v0.4.5`
- Automated test suite and architecture invariants pass.
