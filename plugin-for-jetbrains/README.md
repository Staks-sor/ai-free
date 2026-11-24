# SYNVOX for PyCharm

JetBrains Platform shell for the shared SYNVOX runtime. The plugin starts the bundled local
backend on `127.0.0.1`, passes the active PyCharm project as its workspace and embeds the existing
SYNVOX UI in a right-side tool window.

SYNVOX is free for personal use. Sign in to the AI providers you use. Provider limits apply separately.

## Requirements

- Qwen/DeepSeek browser sign-in requires Python 3.10+ from [python.org](https://www.python.org/downloads/), available in PATH (restart the IDE after installation). Camoufox and its browser download once from PyPI/GitHub. Settings → Accounts shows preparation progress and actionable errors. Interactive Linux/WSL/SSH sign-in requires a graphical display (WSLg/X11).

- PyCharm 2025.2 or newer
- Node.js 22 or newer (`AI_FREE_NODE_PATH` can override discovery)
- JetBrains Runtime with JCEF for the embedded interface

## Build

```bash
./gradlew test buildPlugin verifyPlugin
```

The Marketplace-ready ZIP is written to `build/distributions/`.
For version 0.5.0, the runtime synchronization excludes local credentials, environment files,
development caches, generated output, and dependency test assets.

## Publish

Create the plugin once in JetBrains Marketplace, then set `PUBLISH_TOKEN` and run:

```bash
./gradlew publishPlugin
```

Signing uses the standard `CERTIFICATE_CHAIN`, `PRIVATE_KEY` and `PRIVATE_KEY_PASSWORD`
environment variables.
