# Qwen: доставка и восстановление

2026-10-13, Codex. `main/3db7d9c`; изменения локальные, незакоммичены, без публикации и перезапуска программы.

## Причина

Текущая задача получала QWEN_ANTIBOT_PUNISH с неизвестной доставкой. После четырёх проверок истории подтверждённое not_sent возвращало true в recoverSavedModel; runner обходил retry budget и снова отправлял запрос. Цикл повторялся примерно каждые восемь минут. Проверка сессии появлялась только после выхода из Harness. Остановлена только проблемная задача; checkpoint сохранён.

## Исправления

- `src/harness/conversation-runner.mjs`, `auto-continue.mjs`: различаются recovered/not_sent/unresolved; события проверок сохраняются. Transport obeys retry budget, challenge не отправляется автоматически повторно. Stop фиксирует cancelled.
- `src/window-app/server.mjs`: проверка Qwen появляется при первой ошибке, существующий статус окна сохраняется; текст ожидания не обещает безусловное продолжение.
- `src/providers/qwen/native-composer.mjs`, `browser-proxy.mjs`, `client.mjs`: штатные модель/режим/поле/Send, оригинальные body/headers сайта, клонированный SSE. Публичный account proxy exposes submitNativeTurn; очередь и bridge изолированы по worker/turn. Чат/model/parent/prompt и противоречащие aliases проверяются до POST. Observer допускает один POST; при пропущенном первом нажатии разрешён один guarded click, затем bounded failure. Stop aborts fetch. Ошибки не создают новый чат и не включают synthetic fallback. Большой текст остаётся в composer; изменение полного текста блокирует отправку.
- `harvest.mjs`: unique completed root ответ восстанавливается; пустая root история не доказывает отсутствие отправки. Старые attachment checkpoints сохраняют upstream prompt.
- Desktop/VS Code runtime синхронизированы.

## Проверки

Новые focused regressions red→green. `node --test test/qwen-native-composer.test.mjs`:19/19. Qwen/Harness/metrics до последних driver regressions:408/408. Финальный isolated `node --test --test-concurrency=4 --experimental-test-coverage --test-reporter=./scripts/coverage-reporter.mjs test/*.test.mjs`:1432/1432,189 suites,16 coverage gates PASS. `npm run check:ci`, build, mirrors, `git diff --check`:PASS.

Авторизованный пользователем браузер: штатный запрос OK/HTTP200; импортированный capture NATIVE_OK/HTTP200/5 chunks; весь актуальный imported driver DRIVER_OK/HTTP200. Только диагностические тексты, без проекта/файлов/credentials. Диагностические hooks удалены; screenshots в `output/qwen-recovery-20261013/`.

Preview `package/synvox-desktop-preview.zip`:280 runtime files, SHA256 `3e78a95b331ef2bd95afbe1b9e58e1672a38e840f2ef842d004e9caf759abb03`. `verification.json` подтверждает bytes/mirrors.

## Остаток

Нужен ручной restart SYNVOX и приёмка сохранённой задачи в его Camoufox profile. Реальный профиль программы отличается от авторизованного in-app браузера. Проверки Qwen остаются возможны; CAPTCHA не решалась, identity/security не менялись. Windows/Linux и длинные prompts требуют живой приёмки.
