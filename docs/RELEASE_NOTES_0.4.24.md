# AI Free 0.4.24

AI Free 0.4.24 improves provider streaming and makes shared Desktop and VS Code code easier to keep synchronized.

## Changes

- Qwen reasoning chunks now count as meaningful stream activity, preventing false first-content timeouts before a tool call.
- Large OpenAI-compatible tool schemas are compacted before they are sent to Qwen, reducing prompt overhead without dropping tool names or required parameters.
- Qwen 3.7 Plus and Qwen 3.7 Max were verified against the live API with 28 tools, including the final `finish_reason: "tool_calls"` chunk.
- DeepSeek reasoning and final-answer fragments are separated consistently across the whole SSE stream.
- Assistant reasoning is displayed in a localized, collapsible block in Desktop and VS Code.
- ChatGPT uses the active web-session model when the selected label is not available for the signed-in account.
- A duplicate-module inventory and CI invariant now detect accidental drift between shared Desktop and VS Code files.
- Desktop, VS Code and JetBrains/PyCharm versions are synchronized at `0.4.24`.

Thanks to [@dimazzq92](https://github.com/dimazzq92) for the architecture inventory and provider/UI fixes in [PR #17](https://github.com/Staks-sor/ai-free/pull/17) and [PR #19](https://github.com/Staks-sor/ai-free/pull/19).

## Compatibility

- Node.js 18 or newer.
- macOS, Windows and Linux desktop/API runtime.
- VS Code 1.75 or newer.
- PyCharm 2025.2 or newer with JCEF and Node.js 18+.
