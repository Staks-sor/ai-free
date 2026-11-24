# Harness, skills и память

2026-11-06. Codex; локально, незакоммичено, `main/3db7d9c`.

## Код

`src/harness/`: task-state/conversation-runner/checkpoints/events, scheduler, errors/auto-continue, verifier, handoff и task-view. Scheduler: два workers/16 queued, FIFO/отмена. `src/window-app/{server,agent-task}.mjs`: dispatch/роль/resume. `src/code-agent/`: tools/prompts/reads/cancellation. `src/{skills,plugins,agent-orchestrator}/`: activation/context.

## Выполнение

Execute направляет сообщения в агент; Discuss запрещает автоматические tools. Разговорный finish допустим, проектные утверждения требуют evidence. Prompt23 сообщает ОС/доступ.

Чаты сохраняют goal/provider/workspace/session/account/checkpoint/role/skill, до30 file paths и summary1200. Shell не даёт полного списка paths. Последние100 событий versioned. Checkpoints/final/flush awaited, coalescing100ms; conflict явный. `STORAGE_PLAN.md`.

Quota rejection/transport not_sent: две попытки60/120секунд, delay до30минут; ожидание освобождает worker. Stop/context change отменяет replay. Auth/challenge требуют восстановления. Restart помечает abandoned tasks interrupted без запросов; live ownership сохраняется. Unknown delivery/прерванный tool требуют проверки.

`verify_task`: 1–5 checks, последовательно, 30 секунд/команду. Exit outcomes сохраняются; последующие mutations сбрасывают verification. Failed checks предотвращают успех; отсутствие checks — not_run. Разрешения/owner approval действуют.

## Передача и контекст

Manual handoff создаёт same-workspace чат с bounded goal/result/paths/checks, без session/checkpoint/raw logs/автоотправки. Busy/unknown delivery/interrupted tool/другой workspace запрещены; permissions сохраняются. Skills activation32Ki, resources16KiB; project instructions16KiB/8 файлов/500 directories. При усечении читать применимые AGENTS вручную.

## Qwen: восстановление 13 октября

Awaiting_model/unknown: GET сразу, затем15/45/120/300секунд без POST. Unique completed reply используется однажды. Stop сохраняет cancelled/qwenTurn. Missing root не разрешает replay; not_sent не обходит лимиты. Native composer сохраняет чат/ветку; fresh-chat retries запрещены. Manual Continue разрешается только после proof либо not_sent. Executing_tool guards сохранены, кроме доказанного завершённого отказа verify_task ниже. Startup не запускает tools. `QWEN_MODE_FIX-2026-10-13.md`, `PROVIDERS.md`.

## Workspace: план и проверки

update_plan сохраняет1–12 шагов, максимум один in_progress. Incomplete finish возвращает модель в loop; bounded отказ даёт failed/ready checkpoint, native toolCallId получает error. Доска хранит30 snapshots/чат. Verification обязательна после любых file mutations/mkdir и выполненных commands, включая timeout/nonzero exit; mutations сбрасывают pass. Разговор/read-only tools без checks. Compact adapters сохраняют роль/handoff/plan; Antigravity выполняет общий loop через изолированный CLI agent без native tools.

## Доступ к компьютеру: 13 октября

Per-chat Project/Computer сохраняется, не переключается во время работы и передаётся всем provider/resume branches. Computer разрешает executable paths, cwd, shell и файлы вне workspace; другие чаты сохраняют ограничения. Native desktop tools используют отдельный worker, OS permissions и Stop; режим не повышает привилегии. Vision пока ChatGPT/GoogleAI, Linux GUI толькоX11. `COMPUTER_ACCESS.md` содержит пути и ограничения.

Fatal завершённый tool сохраняет ready checkpoint. Старый verify_task отказ восстанавливается лишь по подтверждённым completion events; неизвестные model/tool outcomes требуют прежней проверки. Реальная сохранённая Qwen-задача завершилась completed/passed,4/4; Godot проверен3/3. Coverage1587/1587,190 suites,16 gates, CI/build/mirrors/diff PASS; Desktop перезапущен. Семантическая полнота игры не доказана.

6 ноября: Qwen-кодер принят до/после перезапуска; русский итог, файлы,3/3→6/6. [Протокол](QWEN_CODER_ACCEPTANCE-2026-11-06.md).
