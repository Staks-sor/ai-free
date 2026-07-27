# AI Free 0.4.8

AI Free 0.4.8 is a reliability release for desktop and the VS Code extension.

## Windows Node.js and npm

- Diagnostics and the updater now use the same runtime resolver.
- AI Free finds `node.exe` and `npm.cmd` in standard Node.js MSI locations even when the GUI process has a restricted `PATH`.
- Discovery includes the running Node.js directory, `%ProgramW6432%`, `%ProgramFiles%`, `%ProgramFiles(x86)%`, `%APPDATA%` and `%LOCALAPPDATA%`.
- The updater can invoke npm through `node.exe` and `npm-cli.js` when `npm.cmd` is unavailable.

## ChatGPT authorization

- The initial account verification uses a regular Chrome window and closes it only after the active ChatGPT session is validated.
- Subsequent requests use the saved hidden Camoufox session inside AI Free.
- Sessions with `RefreshAccessTokenError` are rejected and no longer appear connected.
- OAuth popup pages and exact cookie domains are preserved during synchronization.
- Closing the login window early reports a recoverable error instead of terminating AI Free.

## Release parity

- Desktop, CLI and compatible APIs: `0.4.8`
- VS Code extension: `0.4.8`
- Release tag: `v0.4.8`

Verification: 371 automated tests, CI architecture invariants, desktop runtime diagnostics and packaged VSIX content checks.
