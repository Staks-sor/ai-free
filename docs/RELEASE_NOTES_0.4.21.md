# AI Free 0.4.21

AI Free 0.4.21 recovers Qwen-compatible SSE requests that stall before the
first response content in desktop and VS Code OpenAI-compatible integrations.

## Qwen OpenAI-compatible API

- Applies a dedicated first-content timeout to Qwen streams instead of waiting indefinitely on service-only events.
- Cancels the stalled browser request and retries once in a fresh server-issued Qwen chat.
- Avoids redundant browser-level retries and unnecessary authentication refreshes.
- Keeps the desktop and VS Code API implementations identical.

## Verification

- Full test suite: 466 tests passed.
- CI architecture invariants passed.
- A real `qwen3.7-plus` streaming request with 27 tools completed with content, `finish_reason: stop`, and `[DONE]`.
- A forced first-content timeout created one fresh server-issued chat and terminated with a valid SSE error instead of hanging.
- Desktop and VS Code versions are synchronized at `0.4.21`; PyCharm is not part of this release.
