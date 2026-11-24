# Завершение плана SYNVOX

2026-10-03, Codex. `main/3db7d9c`, общие незакоммиченные изменения; без новой публикации.

Локальная очередь реализации закрыта. Ralph: focused тест до изменения, минимальная реализация, full checks, зеркала Desktop/VS Code. По поручению владельца следующая стадия — его ручная приёмка, затем выпуск. Чужие изменения сохранены.

## Очередь и приёмка

1. **Регулятор пяти providers — локально внедрён.** Qwen/DeepSeek уже сохраняют ограничения. Confirmed HTTP ограничения ChatGPT/GLM/Google AI проверяются перед отправкой и внутри ожидания, без новых guessed quotas/floors, лишних timers и replay unknown delivery. Проверить Retry-After, отмену, restart/account isolation и отсутствие удвоенных retries.
2. **RAG — локально внедрён.** Memory/anti-repeat имеют общий UTF-8 budget 8 KiB, кеш 64 записи, инвалидирование DB/WAL/index/graph, workspace isolation; cross-process обновление проверено. Без удалённых embeddings/AI-запросов для поиска.
3. **Общий AccountManager — локально внедрён.** Все пять Web AI: до десяти аккаунтов, изолированные auth/profile, default-миграция, restart/выбор/rename/reconnect. Metadata CAS проверен шестью процессами; активные запросы блокируют reconnect в текущем процессе. Chat/code/pipeline/upload/API/DeepSeek CLI используют выбранную identity. Не переносить provider thread/parent IDs между аккаунтами.
4. **Handoff и роли — локально внедрены вручную.** «Передать задачу» создаёт свежий чат выбранного AI/роли в том же workspace с сохранённым skill и bounded summary. Без provider sessions/checkpoint/raw logs и автоматической отправки. Busy/unknown/interrupted tool блокируются. Роли и прошлый результат достигают chat/compact/native coding.
5. **UI — локально внедрён.** N/10/rename/select/reconnect всех пяти AI, роли и общий context chat/code. «Агенты и задачи» показывает сохранённые профили чатов, status/цель/проверки/paths, Continue и Stop. Продолжение проверяет актуальный task ID/provider/model/workspace/account и delivery; двойное нажатие не дублирует запрос. Без нового polling или фоновых AI-запросов. Fixture 1440/390: действия, computed styles и screenshots проверены.
6. **Живая приёмка — частично.** GLM повторяющиеся ответы исправлены; DeepSeek/Google AI/ChatGPT отвечали. Qwen требует входа. Проверить свежий runtime, отмену, ограничения/auth/challenge и ресурсы; Linux GUI зависит от доступного окружения.
7. **Локальные сборки готовы.** Desktop preview, VS Code VSIX и JetBrains ZIP 0.5.3: в каждом 266 runtime-файлов совпадают с исходниками. `output/review-20261003-final/manifest.json`, SHA256SUMS; не опубликованы. Перед публичным выпуском нужен чистый snapshot и решение о версии; не заменять существующий versioned archive.

`npm run test:coverage`: 1210/1210, 16 gates; `npm run check:ci`, VS Code build и JetBrains buildPlugin passed. Ручная приёмка: `MANUAL_ACCEPTANCE.md`.

## Ограничения

Qwen login, реальные дополнительные аккаунты и CAPTCHA требуют участия владельца. Универсальный CAPTCHA solver не обещается. Пиковая память двух активных браузеров пока около 2 GiB; одна idle сессия и cleanup уже реализованы. API/CLI/resume пути включать в проверку каждого этапа; не объявлять этап завершённым по одному новому модулю.
