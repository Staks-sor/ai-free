# AI Free 0.4.6

AI Free 0.4.6 is a stability release for the desktop application and VS Code extension.

## Fixed

- Restored the missing diagnostics module in the packaged VS Code extension. Version 0.4.5 could exit during startup before opening the local server.
- Removed the hard dependency on a responsive `node.exe` from the Windows `PATH`. The extension now prefers the compatible Node.js runtime bundled with VS Code or Cursor.
- Falls back to an explicitly configured `AI_FREE_NODE_PATH` or Node.js 18+ from `PATH` when the IDE runtime is too old.
- Preserves the dedicated ChatGPT browser profile and cookies during normal re-authorization.

## Release safeguards

- The extension build now imports the server entrypoint and fails on missing or invalid module exports.
- Desktop and extension diagnostics are checked for exact synchronization.
- The packaged VSIX is verified to contain the diagnostics module and is started through an IDE Electron runtime before release.

## Versions

- Desktop, CLI and compatible APIs: `0.4.6`
- VS Code extension: `0.4.6`
- Release tag: `v0.4.6`
