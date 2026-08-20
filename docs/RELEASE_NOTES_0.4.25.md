# AI Free 0.4.25

AI Free 0.4.25 improves Qwen compatibility with Hermes and other OpenAI-compatible agents while continuing the shared-core cleanup.

## Changes

- Valid unfenced Qwen JSON tool calls are converted to OpenAI `tool_calls` instead of being returned as ordinary assistant prose.
- The streaming bridge holds detected tool JSON until it can emit one unambiguous tool turn with the terminal `finish_reason: "tool_calls"` chunk.
- Bare calls are accepted only when their names match tools supplied by the client, reducing false positives and invented-tool failures.
- Slow Qwen generations can wait up to four minutes for first content and ten minutes overall while the idle timeout still detects stalled streams.
- Long technical answers that merely discuss `401 Unauthorized` no longer invalidate a healthy Qwen session.
- Desktop, standalone API and VS Code load `.env` before the provider module graph.
- Shared model catalog, localization, parser and memory utilities now live in `packages/core` with compatibility re-exports for Desktop and VS Code.
- Desktop, VS Code and JetBrains/PyCharm versions are synchronized at `0.4.25`.

Thanks to [@firegoaway](https://github.com/firegoaway) for the detailed Hermes diagnostics and the reference implementation shared in [issue #21](https://github.com/Staks-sor/ai-free/issues/21). Thanks to [@dimazzq92](https://github.com/dimazzq92) for the shared-core migration in [PR #20](https://github.com/Staks-sor/ai-free/pull/20).

## Compatibility

- Node.js 18 or newer.
- macOS, Windows and Linux desktop/API runtime.
- VS Code 1.75 or newer.
- PyCharm 2025.2 or newer with JCEF and Node.js 18+.
