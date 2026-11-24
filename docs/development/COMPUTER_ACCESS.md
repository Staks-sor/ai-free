# Доступ к компьютеру

Обновлено: 2026-10-14, Codex. `main/3db7d9c`; исходники незакоммичены, Desktop0.5.60 опубликован. Связанные правила: `HARNESS.md`, [VISION.md](VISION.md).

## Поведение

В composer появился сохраняемый выбор «Проект / Компьютер» для конкретного чата. Старые и новые чаты начинают с Project; изменение во время задачи запрещено. Computer разрешает произвольные executable paths, shell, cwd и чтение/изменение/удаление файлов за пределами проекта, включая обычные операции, ранее требовавшие отдельных command permissions. Другие чаты и глобальный Allowed commands сохраняют свою политику. Доступ не повышает системные привилегии; skills продолжают ограничивать набор инструментов. Prompt23 сообщает реальную ОС и запрещает несвязанные действия.

Пути: `src/state/conversations.mjs`, `src/window-app/{server,agent-task,workspace-ui-script,workspace-ui-styles,ui-html}.mjs`, `src/code-agent/{access-policy,executor,prompt,native-tools,run}.mjs`, `src/skills/permissions.mjs`. Передача режима проверена для всех provider branches и resume.

`src/computer/{service,native-worker}.mjs` предоставляет snapshot/click/move/drag/type/key/scroll через optional `@jitsi/robotjs@0.6.24`; PNG кодирует `pngjs@7.0.0`. Native worker изолирован, имеет timeout/Stop, освобождает нажатые клавиши/кнопки, не наследует debugger flags. macOS проверяет Accessibility/Screen Recording и logical geometry через фиксированный JXA helper. Linux требует X11; Wayland возвращает явную ошибку.

Снимки и `read_image` передаются как изображения ChatGPT/Google AI/Qwen/DeepSeek/GLM/Codex через общий Harness. `browser_snapshot` также передаёт screenshot. `computer-images.mjs` исключает pixels из текстовых логов/checkpoints, сохраняя private ссылки с0600 для resume; после ответа файлы удаляются. Antigravity CLI явно сообщает отсутствие vision. Подробности и provider acceptance: `VISION.md`.

Завершённый fatal tool result получает ready checkpoint. Старый отказ verify_task восстанавливается только при доказанной последовательности checkpoint_saved → tool_finished(false) → task_finished(failed), без replay неизвестного действия и без подмены verification.

## Проверки

Red→green: access/execution/continuation, image adapters, worker cleanup, narrow-label clipping и Windows cmd/Unix sh guidance. Node22+ требуется во всех клиентах; plugins включают6 N-API prebuilds. Isolated coverage: **1669/1669**,192 suites,16 gates PASS (`/tmp/synvox-0560-full.log`). CI/VS Code build/sync/diff PASS;289 runtime files одинаковы в source/Desktop/VSIX/JetBrains. Артефакты и публикация: `RELEASES.md`.

macOS capture/permission/native-load успешны; input не выполнялся. Точный ZIP0.5.60 установлен npm ci в чистом Linux ARM64/Node22 Docker; виртуальный X11 дал PNG1280×1024, mouse move/key успешны (`/tmp/synvox-linux-release-check.log`). Windows prebuilds проверены, физический запуск ещё нужен. CI native-load matrix Ubuntu/Windows/macOS добавлен, remote run не заявляется. Ранее Godot3/3, Qwen completed/passed4/4, режим пережил перезапуск. UI1440×900/390×844 без overflow.

## Остаток

Antigravity CLI text-only. Wayland portal driver, несколько мониторов и физическая Windows/Linux/input acceptance остаются. Linux virtual X11 покрывает snapshot/move/key, не все действия. Лицензии не менялись; Desktop опубликован, плагины локальные, commit не было.
