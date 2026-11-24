# Повторный аудит SYNVOX

Завершён 2026-10-13, начат 2026-10-12. Codex, `main/3db7d9c`; незакоммиченные изменения. Продуктовый код не изменён, публикации нет.

## Устройство и рабочие гарантии

UI/API и выбор провайдера находятся в `src/window-app/`; общий цикл инструментов — `src/code-agent/`; задачи, checkpoints, продолжение и доска — `src/harness/`. Обсуждение и выполнение различаются. Роли, память, инструкции проекта и skills готовят контекст; executor проверяет разрешения. Хранилище окна использует immutable JSON revisions и merge/conflicts. Авторизация, аккаунты и лицензирование отделены от выполнения задач.

Доска отображает реальные сохранённые задачи общего Harness. Референс `51366` — отдельный макет. Гарантии зависят от маршрута провайдера; успешная команда не доказывает качество результата. `server.mjs` — 3987 строк, `ui-html.mjs` — 5752: сопровождение крупных модулей и синхронных копий остаётся долгом.

## Подтверждённые проблемы до исправлений

1. **P1 — изменение после Stop.** После ответа модели нет повторной проверки AbortSignal перед инструментом. Mock создал файл после отмены и вернул `stopped:true`. `src/code-agent/run.mjs:176,351`; `executor.mjs:26`.
2. **P1 — отмена Codex не передаётся.** Adapter теряет signal, клиент не вызывает `turn/interrupt`. RPC-запросы до ожидания turn не имеют timeout. `src/providers/codex/agent-adapter.mjs:41`; `app-server-client.mjs:199,253`.
3. **P2 — смена модели во время задачи.** PATCH возвращает 200; задача сохраняет старую модель, продолжение блокируется `context_changed`. `src/window-app/server.mjs:2081`.
4. **P2 — устаревший ответ меняет выбранный чат.** PATCH и loadState после переключения A→B могут снова отрисовать A. `src/window-app/ui-html.mjs:1808,2078`.
5. **P2 — потеря инструкций.** Compact adapters GLM/Google AI/Codex отбрасывают instructions с ролью/handoff. Codex также теряет план и объявления update_plan/verify_task; затронут compact-путь существующего code-контекста. Последующие corrections могут потребовать verification. `src/providers/{glm,google-ai,codex}/agent-adapter.mjs`.
6. **P2 — неполная verification.** package.json записывается и задача успешно завершается без verify_task. Покрыты выбранные расширения; произвольные shell-изменения тоже остаются пробелом. `src/code-agent/run.mjs:377`.
7. **P2 — Antigravity вне Harness.** CLI-сессия сохраняется, задача на доске отсутствует; общие checkpoints и verification не применяются. `src/window-app/server.mjs:2688`; `src/providers/antigravity/window-adapter.mjs`.
8. **P2 — shutdown пропускает cleanup.** Ошибка закрытия браузера исключает server closer и финальный flush. `src/app-shutdown.mjs:56,99`; `server.mjs:3597`.
9. **P2 — повреждённая legacy-история выглядит пустой.** При отсутствии исправных revisions fallback возвращает пустое состояние; исходный файл сохранён. `src/state/window-state.mjs:44,167`.
10. **P3 — накопление Codex buffers.** После чтения 100 завершённых turns остаётся 100 записей. RSS не измерен. `src/providers/codex/app-server-client.mjs:174,208`.

## Проверки и очередь

13 mock/VM/temp-workspace сценариев воспроизведены: [скрипт](../../output/audit-recheck-20261012/reproduce.mjs), [результаты](../../output/audit-recheck-20261012/results.json). Это проверки наличия дефектов, не исправления.

Изолированное покрытие: 1360/1360 тестов, 187 suites, 16 gates PASS. `npm run check:ci`, VS Code build и mirrors PASS. 277 runtime files совпадают с `output/sidebar-footer-20261012-final/synvox-desktop-preview.zip`.

Десять групп исправлены: [AUDIT_RECHECK_FIXES-2026-10-13.md](AUDIT_RECHECK_FIXES-2026-10-13.md). Живые AI, вход, установленная программа, Linux, CPU/RSS и power-loss не проверялись; реальных запросов нет.
