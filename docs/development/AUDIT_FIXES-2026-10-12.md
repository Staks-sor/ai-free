# Исправления аудита — 12 октября 2026

Codex, `main/3db7d9c`. Изменения незакоммичены, не опубликованы. Приложение оставлено выключенным.

## Поведение

- `code-agent/executor.mjs`: путь проверяется по реальному существующему предку/цели; symlink вне workspace или в защищённые каталоги отклоняется, допустимые внутренние ссылки работают. Между проверкой и операцией остаётся filesystem TOCTOU при конкурентной подмене каталогов.
- `code-agent/run.mjs`, `loop-helpers.mjs`: заявления о завершённых изменениях после одних чтений/ошибочных действий получают ограниченную коррекцию. Успешные действия/команды и verification учитываются отдельно от текстовых logs, флаг сохраняется в checkpoint. Планы/объяснения допускаются. Это evidence выполнения, не доказательство правильности любого утверждения модели.
- `window-app/task-runner.mjs`: Stop/stale abort сохраняет слот и сигнал до выхода taskFn; повторный запуск того же чата блокируется.
- `local-http-security.mjs`, server/HTTP/API/settings: общий Host/Origin guard; UI защищён cookie либо браузерным same-origin Fetch Metadata; cookies разделены по порту, HttpOnly/Strict. CSP защищает iframe bootstrap, сохраняя IDE embedding. API без настроенного ключа возвращает401; CORS разрешён локальным клиентам. ChatGPT frame не пересылает локальную cookie, CDN ограничен точным allowlist и не получает auth.
- `memory/db.mjs`: Блокировка атомарно публикуется с owner; JSON insert/delete перечитывают диск под блокировкой, атомарно сохраняют результат, восстанавливаются после SIGKILL; повреждение индекса не затирается. После аварии остаётся небольшой recovery tombstone против гонки cleanup.
- `licensing/client.mjs`: single-flight setup/fetch, verified cache60с, проверка подписи/expiry/id/version при каждом использовании. Истёкший proof сначала обновляется; невалидный не разрешает доступ.
- Account activity/session helpers, managers/pool и ChatGPT login/proxy: межпроцессные CAS leases; lifetime browser leases, busy до освобождения, защита reconnect/refresh/cleanup чужого профиля. Закрытие/ошибка инициализации освобождают владение; failed close сохраняет его.
- Старые Qwen assertions приведены к cooldown0/spacing0. CI использует Node22 для SQLite integration suite; fallback-тесты не требуют SQLite-флага на Node20.

## Проверки и сборка

Новые regressions сначала падали. `npm run test:coverage`:1320/1320, все16 coverage gates PASS. `npm run check:ci`/VS Code build и diff-check PASS; runtime mirrors синхронизированы.

Chrome/Playwright на изолированном HTTP fixture: iframe fetch без cookies200; foreign-origin запрос заблокирован. Живые AI/login и установленный GUI не запускались.

Локальный `output/audit-fixed-20261012-final/synvox-desktop-preview.zip`:271 runtime files побайтно совпадают с текущим исходником; private data/tests не включены. SHA256 `2c13af2eb7dc60dfb4a44063339fa3c6f33d368fad945d5f6cfa650acb55c121`. Это preview, версия0.5.5; опубликованный архив/сайт/updater не заменены.
