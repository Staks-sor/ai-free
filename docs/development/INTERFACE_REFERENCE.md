# Интерфейс: отдельный референс

2026-10-12, Codex. `main/3db7d9c`, локально, незакоммичено, без публикации. Пользователь попросил отдельный референс и обе темы; v1 отклонён как слишком похожий на сайт. Референс v2 одобрен и перенесён в source UI; текущий статус: `WORKSPACE_INTEGRATION-2026-10-12.md`.

## Текущий вариант v2

`output/ui-reference-v2/index.html` — автономный HTML/CSS/JS; README, screenshots и browser-check рядом. Generated output исключён из Git. Loopback51366 теперь показывает v2 через копию в `output/ui-reference-v1/index.html`; прежний вариант сохранён как `original.html`.

Workspace вместо homepage: проекты и история чатов слева, текущий разговор по центру, план/изменения/проверки справа. Проектные вкладки Чат/Задачи/Файлы. Composer закреплён, сообщения scroll independently; inspector скрывается/открывается, на mobile занимает отдельный экран. Оригинальный SYNVOX mark/favicon из website/static встроены в HTML. Нейтральные поверхности, зелёный акцент, dark default; light toggle использует отдельный localStorage key.

Кликабельны: создание chat/task/project, выбор AI, проектные вкладки, message→board, filter/search, details, inline Stop/resume, demo next step, files preview, settings. Редкие параметры остаются в settings/dialog disclosures. Встроенные данные вымышленные, file view read-only.

## Проверки и ограничения

Chrome/Playwright:16 layout combinations (4 views×2 themes×1440/390) без horizontal overflow, JS errors0; computed styles/screenshots осмотрены. Inline Stop/resume без нового dialog, chat→board, files selection, inspector hide/show desktop/mobile PASS. Browser tab пользователя обновлён на v2.

Доска/планы/checks демонстрационные; реальные AI/логины/файлы не подключены. Шаги не поступают из backend; тема persisted, chat/task state in-memory. Большинство settings/аккаунтных действий — объясняющие placeholders.

## Интеграция

Пользователь одобрил перенос v2 в программу. Реальные UI/routes/task plans внедрены, см. `WORKSPACE_INTEGRATION-2026-10-12.md`. Этот HTML сохраняется как design reference; loopback51366 по-прежнему показывает отдельный макет. Основная программа не запускалась, live acceptance выполняет владелец со свежей сборкой.
