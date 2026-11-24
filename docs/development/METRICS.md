# Локальные метрики

2026-10-02, Codex, main/3db7d9c. Локально; без публикации. `REQUEST_POLICY.md`: Qwen pacing: `QWEN_PACING.md`.

## Код и использование

`src/diagnostics/runtime-metrics.mjs`: фиксированные числовые серии, максимум 128 значений на серию. Счётчик и максимум — с запуска backend; p50/p95 — по последним образцам. Без произвольных labels, текстов, аккаунтов, таймеров, файлов и внешних запросов. Desktop/VS Code mirrors синхронизированы.

Подключения:
- `harness/scheduler.mjs`: queue_ms до получения worker slot; отменённая очередь отдельно queue_cancelled_ms.
- `code-agent/run.mjs`: model_ms, model_failed; wrapper вызывает complete ровно один раз, сохраняет this, результат и исходную ошибку.
- `agent-orchestrator/context-assembler.mjs`: rag_ms, rag_cpu_ms, rag_bytes UTF-8, rag_items, rag_failed. Замер включает текущую синхронную сборку памяти; нулевые результаты также учитываются.
- `window-app/diagnostics.mjs`: существующий `/api/diagnostics` и текстовый отчёт показывают метрики, RSS/heap, uptime и CPU user/system текущего Node backend. CPU — накопленные микросекунды, не процент нагрузки.

Сравнить два отчёта диагностики после задач. Для оценки CPU использовать разницу CPU/elapsed между снимками. Диагностика по запросу уже выполняет проверки инструментов; автоматически часто её не опрашивать.

## Проверки

Transport tests 9/9; full coverage 1133/1133, шестнадцать gates, VS Code build, CI/mirrors/diff passed. Проверены bounded storage, percentiles, отсутствие payloads, неизменность результата/ошибок, очередь/отмена с fake clock, вывод отчёта.

Микрозамер коллектора: 100000 записей за 2.49 ms wall на этом Mac; это не профиль всей программы.

## Transport

`measureProviderExchange` наблюдает существующую отправку, не включает streaming принудительно и не повторяет запрос. Для пяти фиксированных providers: attempt_ms/count, failed_attempts и retry_attempts известных client loops; максимум 54 серии × 128 значений. Ошибки относятся к измеряемой границе; callback failure тоже учитывается.

- ChatGPT/GLM/Google AI: граница proxy.sendChat; это попытка браузерной отправки, не HTTP. First-text/content-gap доступны только при существующем onText. Browser setup до sendChat исключён.
- Qwen: основной browser completion через fetchQwenCompletionWithMetrics. Buffered/stream mode сохранён, proxy maxAttempts принудительно 1. Создание response не является content; thinking наблюдается отдельно. Direct fallback: настоящий POST/headers, ответ буферизован, first-text отсутствует.
- DeepSeek: настоящий completion POST, headers, SSE, даже без UI callback. Generated thinking tags отдельно от текста ответа; UI chunks сохраняются.

first_text_ms/first_progress_ms считаются от начала exchange; content_gap_ms — между текстовыми фрагментами, не включая завершающую тишину. headers_ms только там, где доступен реальный Response. Buffered режим не даёт фиктивного first-text. Поля не содержат model/account IDs или тексты.

## Остаток

Нет model/account breakdown, сквозной корреляции retries, полной статистики browser HTTP, Qwen resume/harvest, tail-idle и cache hits. Буферизованные агентные ответы не дают TTFT. Источник callback может быть DOM, поэтому это наблюдаемая задержка, не чистая серверная latency. Дерево браузерных процессов и live baseline не измерены. Сначала реальные baseline при простое/двух задачах/большой истории; затем adaptive policy без снижения floors вслепую.
