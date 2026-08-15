# AI Free 0.4.23

AI Free 0.4.23 improves Windows reliability and hardens the Parakeet V3 voice-input process boundary.

## Changes

- Windows tests now use native path handling and retry temporary-directory removal without hiding persistent cleanup failures.
- SQLite memory and graph databases are closed explicitly before test data is removed, preventing `EPERM` and open-handle leaks on Windows.
- STT launches `.cmd` and `.bat` helpers through a dedicated Windows path while normal executables continue to run without a shell.
- Voice-input language values are normalized to short language tags such as `auto`, `ru` and `en-US` before process launch.
- Regression coverage rejects command-injection payloads containing shell metacharacters and quotes while preserving valid language tags.
- Desktop, VS Code and JetBrains/PyCharm versions are synchronized at `0.4.23`.

Thanks to [@dimazzq92](https://github.com/dimazzq92) for the Windows test fixes and for iterating on the review feedback in [PR #16](https://github.com/Staks-sor/ai-free/pull/16).

## Compatibility

- Node.js 18 or newer.
- macOS, Windows and Linux desktop/API runtime.
- VS Code 1.75 or newer.
- PyCharm 2025.2 or newer with JCEF and Node.js 18+.
