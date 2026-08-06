# AI Free 0.4.20

AI Free 0.4.20 fixes empty Qwen OpenAI-compatible streams and adds the verified PyCharm plugin source.

## Qwen API reliability

- Retries one empty Qwen stream in a fresh server-issued chat before closing the client SSE connection.
- Preserves the normal OpenAI sequence: assistant delta, content or tool calls, terminal `finish_reason`, then `[DONE]`.
- Rejects empty or invalid tool-call blocks instead of reporting a successful tool turn with no calls.
- Applies the same OpenAI-compatible bridge to desktop and VS Code.

## PyCharm plugin

- Adds the AI Free tool window for PyCharm 2025.2 and newer.
- Bundles the shared AI Free backend and uses the active project as its workspace.
- Uses public Java and IntelliJ Platform APIs only.
- Passes JetBrains Plugin Verifier checks for the supported PyCharm release matrix.

## Verification

- Full test suite: 463 tests passed.
- CI architecture invariants passed.
- A real `qwen3.7-max` streaming request recovered from an empty first attempt and completed with content, `finish_reason: stop`, and `[DONE]`.
- Desktop, VS Code and PyCharm versions are synchronized at `0.4.20`.
