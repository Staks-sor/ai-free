# Интерфейс и workspace

2026-11-04, Codex. `main/3db7d9c`; исходники незакоммичены. CSP/компактное меню установлены локально в IDE, публичные пакеты не изменены. Desktop/VS Code синхронизированы.

## Главное окно

`src/window-app/ui-html.mjs`, `workspace-ui-script.mjs`, `workspace-ui-styles.mjs`: проекты/чаты слева, разговор в центре, inspector справа. Чат/Задачи/Файлы — вкладки проекта. Composer закреплён; inspector адаптивный. Dark/light/contrast, оригинальный mark/favicon. Роль/browser/pipeline/handoff/tour в «Ещё», thinking/search/voice в раскрываемых controls. Подписка — компактная строка даты/продления; plugins/Telegram/реклама скрыты в нативном «Ещё». Settings/theme/quit доступны отдельно. Footer97px при1440×900. Панель сворачивается кнопкой в шапке, возвращается постоянной кнопкой сверху. Desktop-collapse и раскрытие footer сохраняются в localStorage; мобильная панель закрывается своей кнопкой.

«Обсудить / Выполнить» сохраняет interactionMode. Discussion не запускает workspace tools; explicit /code — отдельный запрос. Legacy chats execute. Running mode/model change409, picker disabled. Continue проверяет origin/task-ID/context и checkpoint. Selection generation защищает state/chat/PATCH/task/external/install polling от поздних ответов. Черновики/attachments сохраняются.

## Доска и файлы

Доска читает реальные taskView/history, не создаёт mock state. Колонки: Очередь/В работе/Нужна помощь/Завершено. Статус, сохранённый plan, phase/tool, changed paths и check outcomes обновляются существующим polling. Stop/Continue используют прежние guarded routes. Нет автоматического replay uncertain/interrupted actions. Последние30 task snapshots на чат сохраняются; архивы не запускаются повторно. Новая задача появляется после отправки рабочего сообщения.

Files list/read идут через workspace сохранённого чата и executor canonical guard: depth4/500 entries/100KB preview. Чтение без AI; paths вне проекта/в protected targets запрещены. UI read-only, mutations выполняет агент с прежними permissions.

## Сохранённые функции

Переход/mkdir в выборе папки сразу обновляет workspace формы. Все пять AI поддерживают10 saved accounts: primary/rename/reconnect, изолированные profiles/auth и chat affinity. Failed login blocks dispatch; session metadata не гарантирует текущую доступность сервиса. Settings polling только во время login.

Manual handoff создаёт same-workspace чат с bounded context, свежей upstream identity и draft без auto-send. Роли/skills/результат доходят до chat/code. Qwen stale verification не открывает старую modal; новое challenge показывается обычным путём, «Позже» подавляет повтор.

## Проверки и остаток

Новые `test/workspace-sidebar.test.mjs`:2 red→green; старый subscription-test уточнён: сама подписка вне disclosure, вторичные действия внутри. UI/workspace/subscription/theme/selection75/75, CI invariants/diff PASS. Playwright1440×900/390×844: computed footer97px/no overflow, реальные collapse/restore/mobile-close и сохранение после reload PASS. Dark/light screenshots: `output/playwright/sidebar-compact-*.png`. VS Code перезагружен при runningCount0; новые controls и сохранённая история подтверждены UI. PyCharm GUI не проверен. Изменены только3 UI-модуля и зеркала; предыдущие установленные файлы сохранены приватно.

4 ноября: VSCode0.5.0→0.5.60 воспроизвёл CSP frame-ancestors violation. `window-app/http.mjs`/зеркало разрешают конкретный `vscode-file://vscode-app`; API-защита сохранена. `vscode-frame-policy.test.mjs`:2 red→green, профильные30/30. Reload восстановил UI/историю. PyCharm0.4.24→0.5.60. Reference51366 — demo; полная AI acceptance остаётся. Историческая проверка workspace: `AUDIT_RECHECK_FIXES-2026-10-13.md`.
