# Исправления повторного аудита

2026-10-13, Codex. `main/3db7d9c`; локальные незакоммиченные изменения. Закрыты десять групп из [аудита](AUDIT_RECHECK-2026-10-12.md). Программа не запускалась; публикации нет.

## Поведение и пути

- **Stop:** `src/code-agent/run.mjs`, `executor.mjs`. Abort проверяется до обращения к модели, после её ответа и checkpoint, на входе executor. AbortError завершает задачу как stopped. Запущенные POSIX commands завершаются группой; Windows использует taskkill `/T /F` для принадлежащего задаче PID.
- **Codex:** `providers/codex/app-server-client.mjs`, `agent-adapter.mjs`. Signal передаётся, активный turn получает interrupt. RPC deadline30секунд, interrupt5секунд. Если Stop пришёл во время turn/start, ожидается ограниченный acknowledgement для получения ID. Unknown delivery не повторяется автоматически. Прочитанные buffers удаляются; оставшиеся ограничены64, frame/turn4Ми символов, stderr64Ки.
- **Выход:** `app-shutdown.mjs`, `window-app/task-runner.mjs`, `server.mjs`. Новые задачи блокируются; settlement ожидается до5секунд перед закрытием transports и повторно перед flush. Ошибка одной фазы не пропускает следующие; браузеры закрываются allSettled, server closer выполняет финальное сохранение.
- **Интерфейс:** `window-app/ui-html.mjs`, PATCH в `server.mjs`. Selection generation защищает state/chat loads, PATCH и task/external/install polling. Модель нельзя менять во время задачи: picker disabled, реальное изменение409; no-op допустим.
- **Контекст:** GLM/Google AI/Codex adapters сохраняют compact instructions, plan и verification guidance. Общий `code-agent/external-agent-prompt.mjs` объявляет существующие plan/check/skill tools.
- **Verification:** `code-agent/run.mjs`. Требуется после всех успешных файловых mutations/mkdir и выполненных commands, включая ненулевой exit/timeout. Разговор/read-only tools не требуют checks. Последующие изменения отменяют pass; permissions сохраняются.
- **Antigravity:** новый `providers/antigravity/agent-adapter.mjs`, `client.mjs`, code route. Общий Harness сохраняет plan/checkpoints/board/checks/permissions и clarification. CLI получает изолированный временный cwd и custom agent без native tools; native tool events отклоняются. Code session сохранена, временные файлы удаляются. [Официальные параметры агента](https://www.antigravity.google/docs/subagents/), [headless CLI](https://www.antigravity.google/docs/cli/headless/).
- **История:** `state/window-state*.mjs`. Corrupt legacy без исправной копии даёт STATE_CORRUPT; read/commit не создают пустую историю. Valid backup мигрирует в revisions, исходный повреждённый файл сохранён.

## Проверки

Focused regressions сначала red, затем green; старый auto-continue fixture теперь проверяет сохранённый файл перед finish. Полный изолированный `node --test --test-concurrency=4 --experimental-test-coverage --test-reporter=./scripts/coverage-reporter.mjs test/*.test.mjs`: **1405/1405**,189 suites/16 gates PASS. `npm run check:ci`/VS Code build/mirrors/diff PASS.

Playwright:1440×900/390×844 ×dark/light; computed disabled/visibility, screenshots, overflow0/errors0. `output/playwright/ui-race-review/`. Preview: `output/audit-fixes-20261013-final/synvox-desktop-preview.zip`,279 runtime files совпали; SHA256 `534c755a8ace723fb0562212ec19f9b3a8f5e81b7e461bde07eb8b1aa0586bd7`.

Живые AI/auth/Antigravity CLI и Windows/Linux GUI не проверялись. Windows termination проверен mock, POSIX descendant — реальным временным процессом. Уже выполненные действия не откатываются; checks не доказывают семантическую полноту. Старый audit reproduce намеренно утверждает наличие дефектов и теперь неприменим; regressions находятся в `test/`.
