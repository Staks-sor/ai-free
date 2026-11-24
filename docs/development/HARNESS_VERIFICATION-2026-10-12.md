# Harness: обязательная проверка изменений проекта

2026-10-13, Codex, `main/3db7d9c`. Локально, незакоммичено; приложение выключено, публикации нет.

## Исправление

`src/harness/conversation-runner.mjs` включает requireVerification для worker. `src/code-agent/run.mjs` требует verify_task после любой успешной write/append/delete/mkdir и выполненной run_command/run_shell, включая nonzero exit и timeout: команда могла частично изменить проект. Проверка определяется действием, не расширением файла; package.json/JSON/YAML/README охвачены. Checkpoints сохраняют требование и результат. Desktop/VS Code mirrors совпадают.

После такого действия finish/text-only completion отклоняется до успешной verify_task. Модель получает инструкцию исправить failed checks и проверить повторно. Записи/удаления/команды сбрасывают pass. Native finish получает tool result. Повторный отказ исчерпывает bounded correction budget и возвращает failed. Tool-step limit/Stop/auth/permissions сохраняются.

Разговорные ответы без изменений не запускают команды. verify_task использует существующий executor/разрешения, не устанавливает зависимости и не выдаёт новых прав автоматически.

## Проверки

Новые regressions сначала red, затем green: config/file/command mutations, partial failed/timed-out command, read-only control; plain/native finish, repair→pass, invalidation/resume/Harness wiring. Полное изолированное coverage1405/1405,189 suites/16 gates PASS; check:ci/build/mirrors/diff PASS. Auto-continue fixture проверяет уже записанный файл без повторной записи.

`output/audit-fixes-20261013-final/synvox-desktop-preview.zip`:279 runtime files совпадают. SHA256 `534c755a8ace723fb0562212ec19f9b3a8f5e81b7e461bde07eb8b1aa0586bd7`. Подробности: `AUDIT_RECHECK_FIXES-2026-10-13.md`.

## Ограничения

Модель выбирает checks; успешный exit не доказывает требования продукта. Проверка shell-изменений обязательна, но changed paths из произвольной команды не извлекаются полностью. Explicit acceptance criteria и обязательная семантическая/browser проверка остаются работой. Живой AI/CLI/GUI не запускался; автономность ограничена ресурсами/permissions/loop budget.
