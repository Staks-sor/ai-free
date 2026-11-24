# Qwen: общий регулятор частоты запросов

2026-10-02, Codex, main/3db7d9c. Локальные изменения, без публикации. Подэтап `REQUEST_POLICY.md`.

## Поведение

`request-pacing.mjs` использует `providers/request-budget-store.mjs`: Desktop/VS Code делят состояние provider/account в AUTH_DIR/request-budgets. Имена каталогов — SHA-256 идентификатора; содержимое — числовые сроки/счётчики и ограниченный список operation IDs, без prompts/tokens/cookies. SYNVOX_REQUEST_STATE_DIR позволяет изолировать тесты. In-memory режим используется только тестами.

Immutable JSON устанавливается через fsync + exclusive link, конфликт резервирования повторяется от свежего состояния, максимум 32 попытки. Operation IDs защищают от повторного применения при CAS; сохраняются две версии. Незавершённый staging игнорируется, файлы умерших процессов удаляются при следующей записи. Повреждённая committed версия блокирует отправку, прежний cooldown не обнуляется. Новых зависимостей, idle polling/процессов нет. Короткие файловые операции синхронные; влияние на отзывчивость под живой нагрузкой ещё не измерено.

Проверяются reservation и dispatch: после очереди/подготовки browser page, перед page.evaluate(fetch), заново учитываются интервал и ограничения. Длинный завершённый turn расходует интервал естественно. Floor default 4000 ms; явный 0 отключает spacing, сохраняя ограничения. Punish увеличивает penalty до cap default 60000 ms; каждые три подтверждённых ответа уменьшают его. Поздний ответ не снимает новый punish. Helper empty-stream пока не подключён в production.

HTTP 429 сохраняет Retry-After (секунды/HTTP date; без корректного значения fallback 60 s), включая browser и direct. Срок не сокращается новым меньшим значением/успехом/CAPTCHA clearance. Истёкший deadline не добавляет повторной задержки: Harness fallback 60/120 s учитывается отдельно как минимальный срок. Unknown delivery остаётся без replay. Restart сохраняет бюджет, сам не отправляет запросы.

`harness/scheduler.mjs` освобождает worker на ожидание pacing, возвращает его через ограниченную FIFO очередь. Ожидающие входят в общий queue budget; Stop отменяет sleep/повторное получение worker. Перед POST проверка повторяется. Основные completion используют один proxy attempt. Активный browser request/resume ещё не полностью отменяемый.

## Проверки и дальше

1133/1133 full tests, VS Code build; 16 coverage gates. Проверены два реальных процесса, restart, SIGKILL до/после публикации, reused revision race, позднее пробуждение, decay, 429 без второго POST, отмена/лимит очереди. CI/mirrors/diff passed.

Другие providers, resume/harvest/probes, account concurrency/fairness между процессами и RAG cache впереди. Budget ограничивает старты основных completion, не число всех активных HTTP операций. Живой baseline нового кода отсутствует: ранее backend был старым, Qwen needs_login; runtime не перезапускался, внешние completions не создавались. Отмена может оставлять консервативный reservation gap. Для отката сохранить cooldown/checkpoints; не запускать старый клиент параллельно с новой политикой.
