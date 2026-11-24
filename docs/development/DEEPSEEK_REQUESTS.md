# DeepSeek: подтверждённые ограничения запросов

2026-10-02, Codex, main/3db7d9c. Локально, без публикации; этап `REQUEST_POLICY.md`.

## Поведение

Лимит провайдера неизвестен. Постоянный интервал/оценка оставшихся запросов не добавлены. `request-cooldown.mjs` использует общий numeric store: DeepSeek/стабильный accountId в AUTH_DIR/request-budgets. Текущий единственный сохранённый аккаунт — default; будущий account pool должен передавать стабильные ID. Секреты/промпты в записи не попадают.

HTTP 429 сохраняет Retry-After в секундах или HTTP date; когда корректного срока нет, используется прежний клиентский fallback 60 s. SSE hint rate_limit_reached также сохраняет срок. `retry-after.mjs` теперь общий для Qwen/DeepSeek; Qwen re-export сохраняет существующий интерфейс. Новая меньшая пауза не сокращает прежний deadline. Его истечение не добавляет новый sleep; до confirmed rejection никаких задержек нет.

Ограничение проверяется до PoW/search preparation и непосредственно перед completion fetch. Второй backend/restart видит срок с диска и получает DEEPSEEK_RATE_LIMIT с delivery=not_sent и остатком ожидания. HTTP 429 имеет delivery=rejected. SSE hint после текста/message ID сохраняет unknown delivery: запрет повторного POST остаётся даже при подтверждённом ограничении.

Прежний unconditional empty-stream retry удалён: повтор разрешён лишь при явном not_sent/rejected. Пустой SSE после HTTP 200 такой гарантии не даёт. Сетевой обрыв/Stop не порождает второй completion. AbortSignal проверяется перед/после подготовки и передаётся completion fetch; подготовительные auth/PoW/upload операции полностью отменяемыми не стали.

Legacy cooldown-retry helper не подключён к production routes. Он теперь использует Harness automaticResumeDelay/classifyProviderFailure: max(provider deadline, fallback 60/120 s), до двух повторов, сроки >30 минут/unknown delivery/прерванные tools без autoreplay. Production Harness уже использует эту политику; новые слои retries не добавлены.

## Проверки и продолжение

1133/1133 full tests; 16 coverage gates, VS Code build, CI/mirrors/diff passed. Реальный клиент с подменённым fetch: 429 → второй клиент не запускает PoW/POST, аккаунты изолированы; новый процесс соблюдает сохранённый часовой срок. Partial SSE/пустой ответ/Stop — один POST максимум. Проверены HTTP date, expiry, corrupted store, fallback, отсутствие сложения пауз и безопасные checkpoint retries. Auth/403/HTML recovery: `PROVIDER_RECOVERY.md`. Внешних completions не было.

Живой baseline CPU/RSS и provider smoke впереди. Общая политика ChatGPT/GLM/Google AI, resume/probes/прочие HTTP пути, RAG cache/бюджет контекста — следующие этапы. Disk protocol общий с Qwen, без новых зависимостей/фоновых опросов. Restart не возобновляет неизвестно доставленные запросы.
