# AI Free 0.4.9

AI Free 0.4.9 fixes duplicated and interleaved Qwen output in desktop, CLI/API and the VS Code extension.

## Qwen SSE response selection

- Qwen can return multiple response candidates in one SSE request using different `response_id` values.
- AI Free now reads `response.created.response_index` and selects the primary candidate with `response_index: 0`.
- Chunks belonging to alternate response candidates are ignored instead of being concatenated into the visible answer.
- The fix covers incremental streaming, buffered non-streaming API responses and direct SSE parsing.
- Older Qwen streams without `response.created` remain compatible through a single-response fallback.

## Verification

- The parser was verified against the complete response attached to GitHub issue #13.
- The recovered 3,149-character output exactly matched the correct answer copied from the Qwen browser UI.
- Desktop and VS Code Qwen clients remain synchronized.
- 373 automated tests and all CI architecture invariants pass.

## Versions

- Desktop, CLI and compatible APIs: `0.4.9`
- VS Code extension: `0.4.9`
- Release tag: `v0.4.9`

Thanks to @lubkazachkina for the detailed report and diagnostic archive in issue #13.
