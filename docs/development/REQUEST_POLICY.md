# RAG и адаптивная отправка

2026-10-08, Codex, main/3db7d9c. `METRICS.md`; Qwen regulator (`QWEN_PACING.md`) и DeepSeek cooldown (`DEEPSEEK_REQUESTS.md`) локально; browser regulators локально.

## Сейчас

`memory/context-builder.mjs` → `agent-orchestrator/context-assembler.mjs` → `runCodeTask`: поиск сохранённого опыта включён при memoryEnabled и признаках продолжения/памяти/диагностики. FTS + локальные 256-мерные feature-hashing векторы, дедупликация, graph один переход; шесть элементов. Это RAG памяти, не индекс исходников и не нейросемантические embeddings.  Memory/anti-repeat дедуплицированы в общем UTF-8 бюджете 8 KiB со ссылками memory:id; cache до 64 записей. Версии DB/WAL/index/graph инвалидируют кеш, включая другой процесс; graph и основной список ограничены workspace.

Qwen `request-pacing.mjs`: default interval0. По требованию пользователя удалены локальные punish/empty cooldown, adaptive penalty и fallback60секунд без Retry-After. Старые punishUntil/penalty не блокируют; только фактический Retry-After сохраняется между процессами. Явная env-конфигурация spacing остаётся опциональной. Harness `auto-continue.mjs`: до двух безопасных повторов с fallback 60/120 секунд. DeepSeek хранит confirmed ограничения; `browser-request-policy.mjs` обрабатывает confirmed HTTP429 ChatGPT/GLM/Google AI, сохраняет per-account Retry-After, проверяет перед отправкой/в существующих loops. Generic403/analytics игнорируются; partial text/Google RPC unknown не replay. Completion tracker учитывает реальные request/requestfinished/requestfailed/close, а не живость процесса. Recovery сохраняет timestamp и допускает not_sent только при завершённом транспорте и полной неизменной истории. Проверки policy/budget/tracker/checkpoint/harness68/68, check:ci/build/mirrors/diff passed; live completion не подтверждён. Изменения незакоммичены.

## Требование

Отправлять при готовом канале. Учитывать provider/account/model, прогресс и подтверждённые ограничения без отдельного AI-запроса для тайминга.

- Один активный model turn на диалог; общий бюджет provider/account между Desktop/VS Code и путями chat/code/API. FIFO без голодания.
- `sendAt = max(readyAt, nextAllowedAt, retryAfterDeadline)`. Для Qwen дополнительных локальных задержек нет; server Retry-After имеет приоритет. Без умножения retries.
- Разделить ожидание очереди, подключения, первого содержимого и простоя потока. Прогресс продлевает допустимое ожидание в ограниченном бюджете; heartbeat не заменяет содержательный прогресс. Отмена прерывает ожидание. Ceilings сохраняются.
- Повтор только rejected/not_sent; unknown delivery требует проверки истории. Auth/challenge приостанавливают отправку. Cooldown переживает restart; ожидание не удерживает browser/worker slot. Health probes редкие, объединённые, без тестовых completions.
- RAG локальный: relevance gate, workspace isolation, ссылки на источник, общий контекстный бюджет, кеш с инвалидированием. Индекс файлов — отдельный последующий этап, инкрементальный и по необходимости.

## Реализация и приёмка

1. **Замеры:** queue/model/RAG CPU/bytes и backend RSS/CPU доступны в диагностике (`METRICS.md`), 1138/1138 tests passed. Пять clients: HTTP отдельно от browser exchanges. Live baseline впереди.
2. **Политика:** pure decision-функция и единый coordinator; адаптеры сохраняют transport/auth. Qwen floor/penalty/decay/cancel, shared persistence/restart/Retry-After и освобождение Harness worker внедрены; mirrors синхронны. Browser regulator: 8 focused tests; restart/account isolation/partial/abort passed. Resume/probes и свежая живая приёмка впереди.
3. **RAG:** внедрён; 4 focused tests, включая другой процесс. Existing RU/EN retrieval/graph checks passed. Исходники не индексируются.
4. **Проверки:** fake clock, длинный thinking/stream, отмена, Retry-After, два backend, restart, fairness, отсутствие дублей/retry multiplication; затем live smoke и CPU/RAM. Сравнить с baseline; пороги принять до rollout.

Откат: отменить ожидающие reservations, сохранить cooldown/checkpoints; вернуть прежние адаптеры. Не воспроизводить неизвестно доставленные запросы. 
