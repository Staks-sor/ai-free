# AI Free 0.4.22

AI Free 0.4.22 removes EconomyOS and stabilizes the local OpenAI-compatible bridge for current Qwen models.

## Changes

- EconomyOS is removed from desktop, VS Code, PyCharm metadata, settings, provider selection and compatible APIs.
- Qwen model discovery now follows the live catalog of the signed-in account instead of keeping unavailable preview models in the static list.
- Requests for a Qwen model that disappeared from the live catalog fail before an empty upstream chat is created.
- Qwen waits up to 60 seconds for the first response content and 90 seconds between later chunks, preventing false empty-stream retries on slow but healthy generations.
- OpenAI-compatible inline images are decoded and passed to DeepSeek Vision or ChatGPT instead of being embedded as JSON text in the prompt.
- Qwen image requests return an explicit unsupported-feature error until AI Free implements Qwen's current OSS upload transport.
- Desktop, VS Code and PyCharm source versions are synchronized at `0.4.22`.

## Compatibility

- Node.js 18 or newer.
- macOS, Windows and Linux desktop/API runtime.
- VS Code extension package is built separately for Marketplace upload.
- PyCharm plugin package is built separately for JetBrains Marketplace upload.
