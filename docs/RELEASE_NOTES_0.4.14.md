# AI Free 0.4.14

AI Free 0.4.14 stabilizes long ChatGPT tasks, Windows tooling discovery and the chat interface in desktop and VS Code.

![AI Free desktop agent](https://raw.githubusercontent.com/Staks-sor/ai-free/v0.4.14/docs/assets/ai-free-agent-0.4.13.png)

## ChatGPT long-task observer

- Generation progress is monitored through a DOM observer instead of fragile fixed timing loops.
- Long responses can continue for up to 30 minutes while ChatGPT is visibly working.
- Temporary observer failures preserve the last known generation state instead of producing a premature empty response.
- Completion detection handles reused message nodes, quiet generation periods and changing response text.

## Windows tooling

- npm discovery works when AI Free is launched from a GUI with a restricted `PATH`.
- The updater finds npm from the running Node.js installation, standard MSI paths, NVM, Volta, Scoop and `%APPDATA%`.
- Safe `.NET` project diagnostics are available through the default `dotnet` permission.
- Package publishing, deletion and global tool/workload mutations remain blocked.

## Interface recovery

- A completed permission request can no longer leave an invisible overlay blocking the composer and chat list.
- Permission actions remain bound to the conversation that created the request.
- A stopped background task cannot erase the running state of a newer task in the same conversation.

## Verification

- Full test suite: 444 tests passed.
- CI architecture and desktop/VS Code parity checks passed.
- VS Code extension build passed.
- Desktop, CLI and compatible APIs: `0.4.14`
- VS Code extension: `0.4.14`
- Release tag: `v0.4.14`
