# AI Free for PyCharm

JetBrains Platform shell for the shared AI Free runtime. The plugin starts the bundled local
backend on `127.0.0.1`, passes the active PyCharm project as its workspace and embeds the existing
AI Free UI in a right-side tool window.

## Requirements

- PyCharm 2025.2 or newer
- Node.js 18 or newer (`AI_FREE_NODE_PATH` can override discovery)
- JetBrains Runtime with JCEF for the embedded interface

## Build

```bash
./gradlew test buildPlugin verifyPlugin
```

The Marketplace-ready ZIP is written to `build/distributions/`.

## Publish

Create the plugin once in JetBrains Marketplace, then set `PUBLISH_TOKEN` and run:

```bash
./gradlew publishPlugin
```

Signing uses the standard `CERTIFICATE_CHAIN`, `PRIVATE_KEY` and `PRIVATE_KEY_PASSWORD`
environment variables.
