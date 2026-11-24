# Каталог моделей

2026-10-12, Codex. `main/3db7d9c`, изменения незакоммиченные; Desktop/VS Code синхронизированы.

## Подтверждённые версии

Проверены официальные страницы, без AI-запросов и чтения аккаунтов:

- OpenAI: [GPT6.1 Sol и GPT6 Astra/Sol/Luna](https://learn.chatgpt.com/docs/models). Sol/Luna доступны в Work/Codex, не в обычном Chat; доступ зависит от плана/rollout. [turn/start.model](https://learn.chatgpt.com/docs/app-server) поддерживает переключение модели следующего хода.
- DeepSeek: [V4.1 Flash](https://api-docs.deepseek.com/updates/), API ID deepseek-flash; старые Flash/Vision aliases временно маршрутизируются в новую модель. Текущий changelog сохраняет API V4 Pro — это уточняет первоначальный анонс его удаления. Точную версию Web без живой сессии не подтвердили.
- Qwen: [Studio](https://chat.qwen.ai/) показывает Qwen3.8-Max; [Omni Flash](https://qwen.ai/blog?id=qwen3.8-omni-flash)3.8 выпущен. Новые IDs из authenticated model list заменяют static fallback.
- Z.ai: [GLM5.3/Flash](https://docs.z.ai/release-notes/new-released) актуальны; наши IDs уже соответствовали им. Возможности API не означают готовый media route SYNVOX.
- Google: [Antigravity models](https://antigravity.google/docs/models) содержит Gemini3.8 Flash и Claude5.5 с ограничениями плана; CLI `models` предоставляет actual IDs. Google Search AI Mode выбирает модель на стороне сервиса; наша настройка google-ai-mode не фиксирует номер Gemini.

## Изменения

`packages/core/src/providers/model-catalog.mjs`: убраны неподтверждённые номера GPT/DeepSeek Web. ChatGPT stable selectors/default сайта; старые GPT IDs сохраняются как canonical aliases. Codex предлагает6.1 Sol/6 Astra/6 Sol/6 Luna; default CLI сохранён. CLI провайдеры исключены из compatible API списка, где dispatch не реализован.

`qwen/model-sync.mjs`: default предпочитает3.8 Max только если live list содержит его, иначе3.7 Plus/первую доступную модель. Сохранённые пользовательские выборы не мигрируются.

`window-app/ui-html.mjs`: начальный каталог генерируется из общего источника, старые Web aliases отображаются современными названиями. `chatgpt/model-selection.mjs`/proxy отвергают неоднозначный/неподтверждённый выбор до отправки. `codex/app-server-client.mjs` передаёт model в каждый turn/start, включая уже attached chat. Зеркала синхронизированы.

## Проверки и поставка

`node --test --test-concurrency=4 --experimental-test-coverage --test-reporter=./scripts/coverage-reporter.mjs test/*.test.mjs`:1358/1358,16 gates PASS; `npm run check:ci`/VS Code build/mirrors/`git diff --check` PASS. Обычный первый coverage run:1355/1356, существующий100ms SIGTERM-test успел завершиться до установки обработчика; ограниченная параллельность устранила гонку запуска. Все новые behavior regressions воспроизведены red/green. Chrome fixture: old selector alias, новые Codex options, PATCH выбора,4 layouts1440/390 dark/light без overflow/JS errors; `output/playwright/model-catalog/`. SYNVOX/live providers не запускались. `output/models-20261012-ready/synvox-desktop-preview.zip`:277 runtime files побайтно совпали с исходником; SHA256 edb3f17500ed0e7675689c76ce940a84b5abcf7b7ab55ad46f93b2da76fe133d.

Остаток: live account availability/совпадение webLabels; будущие обновления static curated catalog требуют проверки, Qwen/Antigravity используют существующее live discovery. Публикация не выполнена.
