# Надёжность и технический долг

2026-10-13. Codex, `main/3db7d9c`. Незакоммичено; без публикации.

## Закрыто в первом этапе

- Хранилище: `src/state/window-state-store.mjs`, `window-state.mjs`. Immutable revisions, fsync/exclusive link, merge/conflicts/удаления, две версии; state.json — миграция. Async очередь100мс; checkpoints/final/HTTP ждут запись, конфликты409. Владение задачей предотвращает дубль.
- `src/browser/session-pool.mjs`: providers запускаются по требованию; две сессии/операции, очередь16. Занятые не вытесняются, одна idle остаётся тёплой; cleanup5мин. Qwen login закреплён; ошибки инициализации закрывают контекст, закрытие снимает listeners.
- API: единый apiLogger, уровень `AI_FREE_LOG_LEVEL`; HTTP-тест 401/CORS/OPTIONS.
- Git исключает артефакты; Gradle Wrapper JAR сохранён. Node>=20, files whitelist; bootstrap выбранного движка.
- CI проверяет README и покрытие16 модулей: >=80% строк, >=70% ветвей, >=80% функций.

## Проверки

Аудит и исправления: [AUDIT-2026-10-12.md](AUDIT-2026-10-12.md), [AUDIT_FIXES-2026-10-12.md](AUDIT_FIXES-2026-10-12.md). Закрыты symlink escape, ложный finish после чтений, перекрытие Stop/start, HTTP guard/CORS/key, concurrent JSON-memory, license cache и межпроцессные leases. Остались filesystem TOCTOU и ручная provider/GUI приёмка.

Повторный аудит и закрытие десяти групп: [AUDIT_RECHECK-2026-10-12.md](AUDIT_RECHECK-2026-10-12.md), [AUDIT_RECHECK_FIXES-2026-10-13.md](AUDIT_RECHECK_FIXES-2026-10-13.md). Stop/Codex deadlines/interrupt, shutdown settlement/flush, task/model/UI identity, compact instructions, verification всех файлов/команд, Antigravity Harness, legacy corruption и Codex buffers исправлены. Windows tree termination проверен mock; живой CLI/GUI остаётся приёмкой.

Изолированное покрытие:1405/1405,189 suites/16 gates PASS. `npm run check:ci`/VS Code build/mirrors/diff PASS. Website ранее21/21/check0/0/build PASS, не изменён. Preview `output/audit-fixes-20261013-final/` совпадает с279 runtime files; публичный0.5.5 прежний. Приложение не запускалось.

## Следующие этапы

1. **Масштаб и обновление состояния.** Конкурентная запись закрыта: реальные два процесса, SIGKILL, миграция и повреждённая версия проверены. `STORAGE_PLAN.md`. Открытые окна обновляют внешние версии существующим опросом; неизменённая история не читается. JSON целиком нормализуется/сериализуется: измерить большую историю перед оптимизацией. Power-loss не проверен.
2. **Ресурсы и запросы.** `REQUEST_POLICY.md`, `METRICS.md`: cooldown, RAG budget/cache и safe continuation внедрены; provider probes впереди. Synthetic 1000 agents ×20 projections: 19 ms; mock pool 50 facades/0 eager launches/idle cleanup passed. Это не browser benchmark. Default ChatGPT/shell/login вне бюджета; измерить реальные CPU/RSS, отмену/смену AI/вход.
3. **Большие модули и копии.** Выделять routes/providers из server и UI по небольшим блокам; затем переносить общую логику в core. Проверять тесты, сборки, зеркала и UI.
4. **Живые проверки и релиз.** `LIVE_ACCEPTANCE.md`, `MANUAL_ACCEPTANCE.md`: владелец проверяет свежий runtime/пять AI/ограничения/auth/challenge/Stop/Linux/ресурсы. Task-status UI реализован. Перед публикацией — чистый snapshot, новая версия при необходимости, публичные downloads/updater.

Все пять Web providers поддерживают N/10/rename/reconnect/primary и изолированные transports. Проверены HTTP/11-й аккаунт/restart/ошибка входа/занятый reconnect/upload affinity; shutdown закрывает pooled accounts. Живые дополнительные logins и concurrent Qwen legacy merge впереди. Очередь: `DELIVERY_PLAN.md`.
