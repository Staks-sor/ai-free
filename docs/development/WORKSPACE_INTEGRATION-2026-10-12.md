# Workspace UI и реальные задачи

2026-10-12, Codex. `main/3db7d9c`. Пользователь одобрил перенос v2 из референса в программу. Изменения незакоммичены, не опубликованы; установленный SYNVOX оставлен выключенным.

## Реализовано

`window-app/ui-html.mjs`, `workspace-ui-script.mjs`, `workspace-ui-styles.mjs`: проектные вкладки Чат/Задачи/Файлы, проектная история чатов, закреплённый composer, inspector задачи, компактные дополнительные controls/settings. Оригинальный mark/favicon. Dark/light/contrast, ширины Desktop/IDE/mobile. Desktop/VS Code mirrors совпадают.

Доска получает taskView/taskHistoryView из существующего state API и polling. Нет демонстрационных карточек или выдуманных процентов. Видны реальный статус/phase/tool, сохранённый plan, paths и проверочные exit outcomes. Continue/Stop используют существующие guarded routes; uncertain delivery/interrupted tools не повторяются автоматически. История сохраняет последние30 safe snapshots на чат. Новая задача появляется из отправленного рабочего сообщения; toolbar открывает создание рабочего чата.

`harness/task-plan.mjs`, runner/view/state, executor/prompts/native-tools: update_plan содержит1–12 explicit steps, один in_progress максимум. План persisted; incomplete finish получает bounded correction в code loop, затем failed с checkpoint ready. Native отказ отвечает на текущий toolCallId; resume сохраняет возможность продолжения. Prompt22 обновляет прежний code context; GLM/Google adapters сохраняют compact plan guidance. update_plan не расширяет права файлов/команд.

Режим interactionMode persisted. «Обсудить» отключает автоматический workspace dispatch, explicit /code остаётся явным запросом. «Выполнить» использует Harness. Resume после discussion возвращает execute только после Origin/context/task-ID проверки. Во время работы режим менять нельзя.

`workspace-files.mjs` + server: GET list/read привязаны к workspace сохранённого conversation; canonical executor guard, depth4/500 entries/100KB preview, traversal/symlink/protected rejection. Содержимое отображается textContent; редактирование выполняет агент с прежними permissions.

## Проверки

Новые regressions сначала падали. Полный test:coverage1348/1348, все16 gates PASS; check:ci/VS Code build/mirrors/diff PASS. Полный suite использовал временный home через os.homedir test preload и установленный test Chromium; реальные профили не изменялись.

Chrome: Harness resume→temporary file write→node check→completed board; persisted modes/files;18 layouts (3 tabs×2 themes×1440/768/390), errors0/overflow0. Stop проверен отдельным сценарием. Fixtures/screenshots/reports: `output/workspace-integration/`. Живые AI/login/GUI не запускались.

`output/workspace-ui-20261012-ready/synvox-desktop-preview.zip`:276 runtime files совпадают. SHA256 `44297f727d03a0af1bdf628eaf308edb20ae1385ebfb6c10f6df5c2714142394`. Preview0.5.5; публичный release/updater неизменён.

## Осталось

Живая приёмка провайдеров и установленного GUI владельцем. План/checks выбирает модель: они не доказывают все продуктовые требования. Автоматический обязательный browser acceptance и полноценное редактирование файлов в UI не внедрялись.
