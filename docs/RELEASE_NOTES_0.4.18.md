# AI Free 0.4.18

AI Free 0.4.18 adds the EconomyOS giveaway campaign to desktop and VS Code.

## Giveaway

- Shows the giveaway automatically when AI Free starts.
- Plays a short notification sound, with a first-interaction fallback when autoplay is blocked.
- Keeps a large campaign banner in the sidebar after the dialog is closed.
- Links participation to `https://vibe.stas-sor.ru/raffle/aifree`.
- Links the published result to the AI Free YouTube channel.
- Shows the participation deadline at 22:00 MSK and the YouTube result time at 23:00 MSK.

## Agent reliability

- Preserves memory and project instructions in compact follow-up prompts.
- Corrects false model claims that workspace write tools are unavailable after tools have already run.
- Lets the bug-fix skill create directories and write or append project files.
- Resets no-tool recovery after successful tool use instead of exhausting the retry budget across a long task.
- Adds tested configuration and execution primitives for agent teams.

## ChatGPT recovery

- Detects a saved ChatGPT session with a missing composer as a login-recovery state.
- Directs the user to the embedded ChatGPT browser instead of returning an ambiguous empty response.
- Removes a duplicated full composer timeout during startup recovery.

## Verification

- Full test suite: 456 tests passed.
- CI architecture and desktop/VS Code parity checks passed.
- VS Code extension build and package passed.

## Versions

- Desktop, CLI and compatible APIs: `0.4.18`
- VS Code extension: `0.4.18`
- Release tag: `v0.4.18`
