# Synvox + Harness: документация к реализации

Статус: Draft

Дата: 2026-09-20

## 1. Назначение документа

Документ описывает реализацию архитектуры, в которой Synvox является продуктовой платформой, а Harness — техническим слоем запуска coding-agent CLI.

Цель — получить единый управляемый запуск Codex, Claude Code, OpenCode и Cursor из Synvox и отказаться от собственной семантической памяти Synvox, насколько это позволяет конкретный agent. При этом Synvox всё равно сохраняет минимальное состояние управления задачами: кто запустил задачу, где она выполняется, как продолжить сессию и чем она завершилась.

Документ является планом реализации, а не утверждением, что текущая версия Harness уже подходит для production без адаптации.

## 2. Резюме решения

Synvox Backend принимает пользовательскую задачу, подбирает модель и контекст, создаёт изолированный workspace, запускает один экземпляр Harness для этой задачи и сохраняет нормализованные события в собственную историю.

```text
Synvox UI
   |
   v
Synvox API / Task Orchestrator
   |  task policy, auth, memory, limits
   v
Workspace Manager ----> isolated workspace / sandbox
   |
   v
Harness Adapter
   |  pinned Harness version, own event contract
   v
Harness process
   |
   +--> Codex CLI
   +--> Claude Code CLI
   +--> OpenCode CLI
   +--> Cursor agent CLI
```

Для MVP Harness запускается как дочерний процесс через внутренний `HarnessAdapter`. HTTP-запрос не должен напрямую создавать процесс агента. Такой слой позволяет позже заменить CLI-вызов на библиотечный Rust API Harness без изменения API Synvox.

## 3. Проблема и цели

### Проблема

У разных coding agents разные бинарники, аргументы, режимы подтверждения и форматы потокового вывода. Если Synvox будет интегрировать каждый CLI отдельно, появится несколько почти одинаковых адаптеров, разные модели ошибок и расходящаяся логика остановки процессов.

### Цели

1. Запускать поддерживаемого агента через один внутренний интерфейс.
2. Получать поток событий для UI, истории и памяти Synvox.
3. Ограничивать права агента режимами `read-only` и `full-access`.
4. Привязывать каждую задачу к отдельному workspace, пользователю и проекту.
5. Останавливать зависшие или отменённые задачи вместе со всеми дочерними процессами.
6. Сохранять только необходимый контрольный state, результат, ошибки, usage и метаданные независимо от UI-соединения; не дублировать долговременную семантическую память агента.
7. Иметь возможность обновлять или заменять Harness без изменения продуктового API.

### Не входит в задачу

- собственная vector/semantic memory и retrieval Synvox как обязательная часть запуска;
- выбор бизнес-маршрутизации моделей;
- платежи, тарифы и лимиты продукта;
- мультипользовательская авторизация Harness;
- публикация изменений в Git, merge или deployment от имени пользователя;
- запуск одного общего долгоживущего Harness-процесса для всех пользователей;
- автоматическая выдача агенту секретов пользователя или production credentials.

## 4. Зафиксированные предположения

- Harness остаётся внешней зависимостью и фиксируется на конкретной версии или commit, а не устанавливается по `latest` во время запуска.
- Доступность CLI и модель аутентификации каждого агента проверяются отдельно. Harness не считается заменой провайдерских credentials.
- Workspace может быть локальным каталогом, контейнером или отдельной sandbox-машиной. Интерфейс Synvox не должен зависеть от конкретного способа изоляции.
- Все события, которые сохраняются в Synvox, проходят через собственный versioned schema. Нативный NDJSON Harness не является публичным API Synvox.
- На первом этапе одна задача использует один агент и один workspace. Параллельная команда агентов — отдельное расширение.

## 5. Границы ответственности

| Область | Synvox | Harness / адаптер |
|---|---|---|
| Пользователь, проект, права | Владелец | Не знает бизнес-пользователя |
| Prompt и память | Собирает контекст и policy | Получает уже подготовленный prompt/config |
| Модель | Выбирает разрешённый alias/ID | Передаёт модель выбранному CLI |
| Workspace | Создаёт, изолирует, удаляет/архивирует | Запускает процесс в переданном каталоге |
| Процесс | Принимает решение о запуске/cancel/timeout | Создаёт process group и читает stdout/stderr |
| События | Нормализует, сохраняет, доставляет в UI | Парсит native output в поток Harness |
| Безопасность | Auth, quotas, audit, secret policy, sandbox | Permission flags и cleanup дочернего процесса |
| История и session registry | Хранит минимальные метаданные и ссылки на session/workspace | Может хранить session log и локальное состояние агента |
| Семантическая память | Опциональна; по умолчанию не дублирует agent memory | Используется нативная память конкретного agent, если она поддерживает resume |

## 6. Компоненты реализации

### 6.1 Task Orchestrator

Оркестратор — единственная точка, которая переводит пользовательский запрос в запуск агента.

Ответственность:

- проверить доступ пользователя и проекта;
- определить разрешённого агента, модель и permission mode;
- получить релевантную память и собрать execution prompt;
- создать запись задачи до запуска процесса;
- запросить workspace;
- вызвать `HarnessAdapter.run()`;
- сохранить и транслировать события;
- завершить задачу с финальным статусом.

Оркестратор не должен содержать парсинг stdout, vendor-specific аргументы или shell-команды.

### 6.2 Workspace Manager

Минимальный контракт:

```ts
create({ userId, projectId, taskId }): Promise<Workspace>
cleanup(workspace, { preserveOnFailure }): Promise<void>
```

`Workspace` должен включать только явно разрешённые файлы проекта. Для `read-only` режима каталог монтируется без записи или дополнительно защищается sandbox policy. Для `full-access` разрешения всё равно ограничиваются workspace, а не всей машиной.

Идентификатор workspace не должен строиться из необработанного имени пользователя или project name. Для каждого запуска используется случайный непредсказуемый task ID.

### 6.3 Harness Adapter

Внутренний интерфейс:

```ts
run(request: HarnessRunRequest): {
  events: AsyncIterable<SynvoxEvent>,
  cancel(): Promise<void>
}
```

Рекомендуемая структура `HarnessRunRequest`:

```ts
{
  taskId,
  agent: "codex" | "claude" | "opencode" | "cursor",
  model: string | undefined,
  prompt: string,
  workingDirectory: string,
  permissions: "read-only" | "full-access",
  timeoutMs: number,
  environment: Record<string, string>,
  extraArgs: string[]
}
```

Ключевые правила адаптера:

- не строить shell-команду конкатенацией строк;
- передавать executable и argv отдельными полями;
- разрешать только allowlist аргументов и переменных окружения;
- не логировать credentials, bearer tokens, cookies и полный environment;
- ограничивать размер строки stdout/stderr и общий объём событий;
- отделять stdout с машинным потоком от stderr с диагностикой;
- возвращать ошибку `agent_unavailable`, если нужный CLI не найден;
- возвращать `unsupported_capability`, если агент не поддерживает запрошенный режим;
- при отмене завершать process group, а не только основной PID.

На первом этапе адаптер может вызывать CLI примерно так:

```text
harness run \
  --agent <agent> \
  --prompt-file <task-prompt-file> \
  --format ndjson \
  --permissions <read-only|full-access>
```

Точные флаги должны быть получены из закреплённой версии Harness во время smoke-теста. Нельзя считать пример выше стабильным публичным контрактом.

### 6.4 Session Registry

Это минимальный обязательный слой Synvox, который заменяет полноценную собственную память. Он не хранит embeddings и не строит общий semantic index. Для каждой задачи он сохраняет:

- `taskId`, user/project ownership и authorization scope;
- `agent` и точную версию Harness/CLI;
- `workspaceId` и привязку к workspace snapshot;
- `providerSessionId` или resume token, если он возвращён агентом;
- последний подтверждённый `sequence` событий;
- статус, exit code, timestamps и ссылку на результат.

Продолжение задачи выполняется только через тот же agent и совместимый workspace. Нельзя переносить session ID Codex в Claude Code или считать, что session ID одинаково работает у всех backend’ов. В публичных материалах Harness resume явно описан для OpenCode и Cursor; наличие и семантика resume для остальных агентов должны подтверждаться smoke-тестом закреплённой версии.

Если агент не поддерживает надёжное resume, Synvox использует новый запуск с коротким handoff prompt, сформированным из последнего результата и выбранных пользователем сообщений. Это fallback, а не полноценная память.

### 6.5 Event Normalizer

Внутренние события Synvox должны быть стабильнее, чем upstream Harness. Минимальная схема:

```json
{
  "schemaVersion": 1,
  "eventId": "evt_01...",
  "taskId": "task_01...",
  "sequence": 42,
  "occurredAt": "2026-09-20T10:00:00.000Z",
  "type": "text_delta",
  "agent": "codex",
  "payload": { "text": "..." }
}
```

Поддерживаемые типы MVP:

| Synvox event | Назначение |
|---|---|
| `task_started` | Задача принята и process запущен |
| `session_started` | Агент сообщил начало сессии |
| `text_delta` | Потоковой текст для UI |
| `message` | Завершённое сообщение |
| `tool_started` | Начало вызова инструмента |
| `tool_finished` | Завершение вызова инструмента |
| `usage_delta` | Incremental usage/cost, если доступно |
| `task_completed` | Успешный финал |
| `task_failed` | Ошибка с безопасным публичным сообщением |
| `task_cancelled` | Остановка по запросу или timeout |
| `diagnostic` | Внутренняя диагностическая информация |

События должны иметь монотонный `sequence`. Повторная доставка не должна ломать UI или память: обработчики используют `(taskId, sequence)` либо `eventId` как idempotency key.

Если конкретная версия Harness поддерживает меньше или больше типов событий, адаптер маппит доступные типы в эту схему, а отсутствие данных обозначает явно. Нельзя подменять неизвестный native event фиктивным успешным результатом.

## 7. Жизненный цикл задачи

```text
created
  -> preparing
  -> running
  -> completing
  -> completed

preparing/running -> cancelling -> cancelled
preparing/running -> failed
```

1. API создаёт `task` со статусом `created` и возвращает `taskId`.
2. Оркестратор проверяет policy, квоту и выбранного агента.
3. Создаётся workspace и immutable snapshot execution context.
4. Prompt записывается во временный файл с правами только для service user.
5. Harness запускается в process group с timeout и лимитами.
6. Каждая строка событий валидируется, нормализуется и сохраняется.
7. UI получает события через существующий realtime-механизм Synvox.
8. При `Result`/exit code оркестратор переводит задачу в `completed` или `failed`.
9. Workspace удаляется по retention policy; при ошибке может сохраняться ограниченное время для диагностики.
10. После завершения Synvox сохраняет результат и session reference. Формирование cross-agent memory не выполняется автоматически.

## 8. Хранение и память

Минимальные сущности:

- `tasks`: пользователь, проект, агент, модель, status, timestamps, timeout, workspace reference;
- `task_events`: task ID, sequence, type, payload, timestamp, schema version;
- `task_result`: exit status, summary, changed files, usage, error code;
- `task_session`: provider session ID/resume token, agent capability и совместимость workspace;
- `task_context_snapshot`: только минимальный handoff context, если native resume недоступен;
- `task_artifacts`: ссылки на diff, logs или результаты, если они сохранены.

По умолчанию Synvox не строит собственную semantic memory и не индексирует task history. Native session storage агента остаётся источником продолжения конкретной coding-сессии. Synvox хранит только control-plane state и пользовательскую историю, необходимую для UI, аудита и восстановления.

Если позднее понадобится память между разными агентами, это отдельная функция импорта/экспорта, а не скрытое поведение Harness. Нельзя считать session storage Claude совместимым с Codex или OpenCode.

Не индексировать автоматически:

- секреты и environment;
- полный stdout/stderr;
- токены и персональные данные;
- неподтверждённые рассуждения агента;
- содержимое всех файлов workspace без policy проекта.

## 9. API Synvox

Публичный API может быть реализован поверх существующего транспорта, но семантика должна быть такой:

```text
POST   /v1/tasks
GET    /v1/tasks/:taskId
GET    /v1/tasks/:taskId/events   # SSE/WebSocket/long-poll
POST   /v1/tasks/:taskId/cancel
GET    /v1/tasks/:taskId/result
```

Пример запроса:

```json
{
  "projectId": "project_123",
  "prompt": "Проанализируй проект и исправь ошибку",
  "agent": "codex",
  "model": "default",
  "permissions": "read-only",
  "context": { "includeMemory": true }
}
```

Клиенту возвращается `taskId` и текущий статус. Полный provider-specific command line и внутренние пути workspace не выдаются пользователю.

## 10. Безопасность и изоляция

### Обязательные меры до production

- отдельный service user для runner;
- workspace за пределами исходного репозитория Synvox и за пределами каталога с секретами;
- allowlist для project mounts и environment variables;
- запрет наследования полного окружения backend-процесса;
- ограничение CPU, памяти, диска, числа процессов и времени;
- process group cleanup при cancel, timeout и падении backend;
- сетевой policy по агенту и проекту;
- redaction секретов до записи событий и логов;
- аудит запуска, отмены, ошибок policy и удаления workspace;
- проверка размера prompt, строк событий, файлов и артефактов;
- проверка symlink/path traversal при подготовке workspace и артефактов.

`full-access` означает доступ к разрешённому workspace в пределах sandbox. Это не должно означать доступ к host filesystem, SSH keys, системным credential stores или Docker socket.

### Отмена и зависшие процессы

Timeout задаётся на уровне Synvox и дополнительно передаётся Harness. При cancel оркестратор:

1. помечает задачу как `cancelling`;
2. отправляет мягкий сигнал process group;
3. ждёт короткий grace period;
4. принудительно завершает группу;
5. сохраняет `task_cancelled` или `task_failed` с причиной;
6. проверяет, что дочерние процессы не остались.

## 11. Надёжность и идемпотентность

- Создание задачи и её запись в БД выполняются до запуска процесса.
- `taskId` не переиспользуется.
- Повторная доставка событий дедуплицируется по `eventId`/`sequence`.
- После рестарта backend незавершённые задачи переводятся в `failed` или повторно поднимаются только при явно определённой retry policy.
- Автоматический retry не выполняется для `full-access` задач, если повтор может повторить destructive command.
- Ошибки provider CLI разделяются на `binary_missing`, `auth_required`, `rate_limited`, `timeout`, `cancelled`, `invalid_output`, `process_exit` и `policy_denied`.
- Результат задачи не считается успешным только потому, что процесс завершился с exit code 0: должен быть валидный финальный event или подтверждённый fallback parser.
- Продолжение задачи использует native session только при совпадении agent, совместимого workspace и capability; иначе задача явно помечается как `resume_unavailable`.

## 12. Наблюдаемость

Метрики MVP:

- количество задач по agent/model/status;
- время до первого события и до первого текста;
- длительность задачи;
- timeout/cancel/error rate;
- размер и скорость event stream;
- количество orphaned processes и не удалённых workspace;
- usage/cost, если агент предоставляет данные.

Логи должны включать `taskId`, `projectId` в псевдонимизированном виде, agent, model alias и error code. Prompt, токены и полный вывод агента в обычные application logs не записываются.

## 13. План реализации

### Фаза 0 — Spike и фиксация зависимости

- **Результат:** подтверждена конкретная версия Harness, список поддерживаемых агентов, реальные CLI-флаги, формат событий и требования к credentials.
- **Затронутые области:** build/runtime image, dependency lock, adapter test fixtures.
- **Зависимости:** установленные CLIs или controlled test doubles.
- **Проверка:** `harness --version`, `harness list`, dry-run каждого агента, чтение NDJSON, тест timeout/cancel.
- **Риск/откат:** не подключать Harness к пользовательскому трафику; удалить только spike-конфигурацию.

### Фаза 1 — Внутренний adapter contract

- **Результат:** `HarnessAdapter`, `SynvoxEvent`, `SessionRegistry`, error taxonomy и нормализатор без API/UI.
- **Затронутые области:** backend task runtime, parser fixtures, schema validation.
- **Зависимости:** результаты Фазы 0.
- **Проверка:** unit-тесты на каждый event type, malformed NDJSON, truncation, stderr, exit codes.
- **Риск/откат:** feature flag выключает adapter и не меняет существующий runtime.

### Фаза 2 — Один локальный workspace и один агент

- **Результат:** end-to-end запуск read-only задачи через один pinned Harness binary.
- **Затронутые области:** workspace manager, orchestrator, task persistence.
- **Зависимости:** Фаза 1.
- **Проверка:** создать задачу, получить stream, завершить, отменить, перезапустить backend, проверить отсутствие orphan process.
- **Риск/откат:** разрешить только внутренним пользователям и тестовым проектам.

### Фаза 3 — Несколько агентов и UI streaming

- **Результат:** Codex, Claude Code, OpenCode и Cursor используют общий Synvox API, если их capability checks пройдены.
- **Затронутые области:** agent registry, UI event consumer, model mapping, provider diagnostics.
- **Зависимости:** Фаза 2; отдельные credentials/лицензии каждого CLI.
- **Проверка:** одинаковый сценарий для каждого агента, сравнение статусов, tool events, usage и ошибок.
- **Риск/откат:** выключение конкретного agent в registry без удаления остальных.

### Фаза 4 — Sandbox и production hardening

- **Результат:** изоляция workspace, quotas, audit, redaction, retention и operational dashboards.
- **Затронутые области:** deployment, security policy, observability, incident runbooks.
- **Зависимости:** Фаза 3.
- **Проверка:** тесты path traversal, secret exposure, resource exhaustion, timeout, cancel и concurrent users.
- **Риск/откат:** production rollout по allowlist проектов с быстрым отключением feature flag.

### Фаза 5 — Оценка библиотечного Rust API

- **Результат:** решение, оставаться ли на CLI adapter или перейти на library integration.
- **Затронутые области:** build pipeline, process boundary, dependency management.
- **Зависимости:** стабильный MVP и измерения.
- **Проверка:** parity-тесты по событиям, cancel, timeout, stderr и exit codes.
- **Риск/откат:** сохранить `HarnessAdapter` как фасад и оставить CLI implementation.

## 14. Acceptance criteria

Реализация считается готовой для ограниченного beta, если:

- задача создаётся и получает устойчивый `taskId`;
- каждый запуск привязан к одному пользователю, проекту и workspace;
- read-only задача не изменяет workspace;
- full-access задача не выходит за пределы разрешённого sandbox;
- UI получает события в правильном порядке и переживает переподключение;
- cancel и timeout завершают весь process group;
- task/result/events сохраняются после закрытия UI;
- после закрытия UI задача может быть продолжена через сохранённую native session, если выбранный agent это поддерживает;
- при отсутствии native resume Synvox не делает вид, что контекст сохранён: UI показывает `resume_unavailable` и предлагает новый запуск;
- ошибки отсутствующего CLI, auth, timeout, malformed output и provider exit различаются;
- secrets отсутствуют в событиях, логах и артефактах;
- повторная доставка событий не создаёт дубликаты;
- feature flag позволяет полностью выключить Harness без поломки существующих задач;
- для каждого поддержанного агента есть smoke-тест на закреплённой версии;
- обновление Harness не проходит без fixture/parity-тестов и ручного dry-run.

## 15. Открытые решения

До Фазы 2 нужно явно выбрать:

1. Где живёт runner: в существующем backend, отдельном worker service или отдельном host.
2. Какой sandbox используется на MVP: container, VM, OS-level sandbox или временный локальный каталог с ограничениями.
3. Как Synvox передаёт credentials агентам: service account, user OAuth session, short-lived token или внешний secret broker.
4. Какой realtime transport уже является стандартом Synvox: SSE, WebSocket или другой механизм.
5. Сколько event data и workspace сохранять, и кто имеет право видеть raw logs.
6. Какие агенты обязаны поддерживать native resume в первом релизе; для остальных допускается только новый запуск с handoff prompt.
7. Какая лицензия и политика обновления распространяются на бинарник Harness и bundled dependencies.
8. Нужна ли прямая библиотечная интеграция с Rust на первом релизе или CLI adapter достаточно.

Пока эти решения не приняты, нельзя обещать production-grade multi-tenant execution.

## 16. Внешние источники и проверенные ограничения

Документ сверялся 2026-09-20 с публичными материалами Harness:

- [репозиторий harness-cli](https://github.com/ayshptk/harness-cli) — поддерживаемые агенты, установка и заявленная MIT-лицензия;
- [архитектура Harness](https://www.harness.lol/docs/reference/architecture) — `TaskConfig`, adapters, process groups, event pipeline и library layout;
- [quick start](https://www.harness.lol/docs/getting-started/quick-start) — CLI flags, NDJSON/text/json output и permission modes;
- [harness.toml](https://www.harness.lol/docs/configuration/harness-toml) — конфигурация default agent/model/permissions/timeout;
- [model registry](https://www.harness.lol/docs/configuration/model-registry) — alias-to-provider model mapping.

Публичные страницы содержат расхождения: README и documentation page упоминают разное количество unified event types и разные варианты имени Cursor binary. Поэтому версия, фактический вывод `--help` и fixtures конкретного релиза должны быть источником истины для адаптера.

Лицензионная проверка этого документа не заменяет юридическую проверку выбранного commit, bundled dependencies и условий распространения Synvox.


## 17. Codex CLI как первый практический backend Harness

### 17.1 Почему начинать именно с Codex CLI

Для первого рабочего внедрения Harness в Synvox рекомендуется использовать Codex CLI как эталонный backend. Это позволяет проверить весь новый task-runtime на одном реальном агенте до подключения Claude Code, OpenCode и Cursor.

Главная цель — не заменить текущий ChatGPT web transport мгновенно, а добавить второй, более устойчивый coding-oriented путь:

 

Codex CLI не должен маскироваться в коде как обычный `chatgpt` provider. В registry это отдельная capability/backend, например `codex`, потому что его lifecycle, session model, tool execution и event stream отличаются от браузерного ChatGPT.

### 17.2 Авторизация: CLI владеет credentials

Целевой UX:

 

Synvox не должен самостоятельно читать, копировать, обновлять или экспортировать provider credentials Codex. Авторизацией владеет сам Codex CLI.

Правила:

- Synvox запускает официальный login flow закреплённой версии Codex CLI;
- credentials остаются в native storage Codex;
- Synvox хранит только статус capability (`installed`, `authenticated`, `version`) и provider session reference, если он нужен для resume;
- auth-файлы Codex не копируются в state Synvox, logs, task events или telemetry;
- при logout/auth failure Synvox показывает `auth_required` и предлагает повторный официальный login flow;
- bundled Codex runtime в будущем не должен означать bundled credentials: пользователь всё равно авторизуется отдельно.

На текущей машине проекта команда `codex` не найдена (`which codex` завершился status 1), поэтому точные login/exec/resume флаги должны быть зафиксированы после установки pinned-версии в Фазе 0. Примеры команд ниже являются проектным контрактом-кандидатом, а не утверждением о текущем локальном runtime.

### 17.3 Процессный адаптер

Рекомендуемая структура:

 

`codex-cli.mjs` отвечает только за процессный контракт:

 

Он не должен содержать продуктовую логику планирования задач, память, UI или бизнес-маршрутизацию.

Порядок запуска:

 

### 17.4 Machine-readable output

Для Harness нужен только структурированный CLI-режим. Если закреплённая версия Codex поддерживает JSON/JSONL event stream, адаптер должен использовать его, а не парсить человекочитаемый терминальный текст.

Нативные события Codex маппятся в общий contract Synvox:

 

Нативный JSON Codex не становится публичным API Synvox. UI работает только с `SynvoxEvent`.

### 17.5 TaskState: Harness важнее конкретной модели

Первый Harness MVP должен хранить состояние задачи отдельно от Codex session:

 

Codex session ускоряет продолжение задачи, но не является единственным источником истины. Если native session потеряна, Synvox всё равно знает goal, criteria, выполненные шаги и verification state.

### 17.6 Resume и восстановление

После установки pinned Codex версии Фаза 0 должна проверить, предоставляет ли она стабильный session/thread identifier и официальный non-interactive resume flow.

Если native resume подтверждён:

 

Если resume недоступен или несовместим:

 

Compact handoff содержит только:

- goal;
- success criteria;
- current step;
- изменённые файлы;
- выполненные side effects/tools;
- последние релевантные test results;
- unresolved problems.

Полная история чата по умолчанию не передаётся.

### 17.7 Verifier обязателен даже для Codex

Успешный exit Codex CLI не должен автоматически означать `task_completed`.

После worker phase Harness проверяет observable success criteria:

 

Verifier может сначала быть deterministic: запуск заранее определённых тестов/build checks без отдельной LLM. Отдельный Reviewer-agent добавляется позже.

### 17.8 Permissions и sandbox

Codex CLI получает только workspace и режим прав, определённые Synvox. Даже если CLI предоставляет собственный sandbox, Synvox сохраняет верхний policy layer.

Минимальные режимы MVP:

 

`full-access` не должен быть пользовательским default.

До запуска:

- executable проверяется по capability registry;
- cwd обязан находиться внутри разрешённого workspace;
- argv строится массивом, без shell string concatenation;
- environment фильтруется allowlist'ом;
- provider credentials не инжектятся Synvox вручную, если native CLI auth уже работает;
- timeout/cancel завершают process group;
- stdout/stderr проходят size limits и secret redaction.

### 17.9 Bundled Codex внутри Synvox

Bundled runtime — отдельная фаза после успешного external-CLI MVP.

Порядок:

 

Плюсы bundled runtime:

- одинаковая версия у пользователей;
- меньше проблем с PATH;
- контролируемый event contract;
- проще support и reproducible bugs.

Минусы:

- обновления и CVE становятся ответственностью Synvox;
- нужно проверять лицензию и правила redistributable dependencies;
- размер дистрибутива растёт;
- нельзя смешивать bundled binary и user credentials без чёткой ownership-модели.

Поэтому bundled runtime не входит в первый MVP.

### 17.10 Обновлённый приоритет фаз Harness

План из раздела 13 уточняется следующим образом.

#### Фаза 0A — Codex CLI spike

- установить одну pinned-версию Codex CLI на dev-машине;
- зафиксировать `--version` и capability output;
- проверить официальный login flow через ChatGPT account;
- проверить machine-readable non-interactive execution;
- проверить session/thread ID;
- проверить resume, cancel, timeout и exit codes;
- сохранить sanitized fixtures event stream для тестов;
- не подключать к production UI.

#### Фаза 0B — Codex capability/auth module

Результат:

 

UI пока не запускает задачи, только показывает диагностику.

#### Фаза 1 — TaskState + SynvoxEvent + CodexAdapter

- `TaskState` с goal/successCriteria/steps/checkpoint;
- versioned `SynvoxEvent`;
- process adapter для Codex;
- parser machine-readable events;
- cancel/timeout;
- unit fixtures без реального provider network.

#### Фаза 2 — Один Codex worker end-to-end

Первый пользовательский сценарий:

 

Без multi-agent routing.

#### Фаза 3 — Resume + recovery

- сохранить provider session reference;
- кнопка `Продолжить` для незавершённой задачи;
- native resume, если подтверждён;
- compact handoff fallback;
- восстановление после рестарта Synvox.

#### Фаза 4 — Harness routing

Подключить текущие Synvox backends к единому task contract:

 

Engine `Auto` выбирает worker, но TaskState остаётся тем же.

#### Фаза 5 — Planner / Worker / Reviewer

Только после стабильного single-worker Harness:

 

Таким образом multi-agent становится надстройкой над устойчивой task-моделью, а не набором нескольких чатов.

### 17.11 Как это будет выглядеть в интерфейсе

Первый UI не должен быть перегружен агентами. Достаточно:

 

В Settings -> Providers:

 

### 17.12 Критерии готовности Codex CLI MVP

Codex backend считается готовым к limited beta, если:

- Synvox определяет отсутствие CLI без crash;
- auth выполняется native Codex flow, а Synvox не читает provider secrets;
- coding task запускается без browser ChatGPT transport;
- structured events преобразуются в `SynvoxEvent`;
- task UI получает streaming progress;
- cancel останавливает весь process tree;
- task state сохраняется независимо от provider session;
- successful process exit проходит Verifier перед `completed`;
- restart Synvox не теряет metadata незавершённой задачи;
- native resume либо реально работает и покрыт smoke-тестом, либо UI честно использует compact handoff fallback;
- browser ChatGPT transport остаётся доступным как отдельный backend/fallback и не ломается внедрением Codex.


### 17.13 Практический MVP-поток Codex CLI внутри Synvox

Ниже фиксируется конкретный пользовательский и технический сценарий первой реализации.

Пользовательский сценарий:

1. Пользователь открывает Settings -> Providers -> OpenAI Codex.
2. Synvox выполняет capability check: найден ли бинарник Codex, какая версия установлена, доступен ли machine-readable режим.
3. Если CLI отсутствует, UI показывает состояние `not_installed` и не пытается подменять его ChatGPT Web.
4. Если CLI установлен, но не авторизован, Synvox запускает официальный login flow самого Codex CLI.
5. После успешной авторизации Synvox показывает `connected`, но не читает и не сохраняет provider credentials.
6. В Coder пользователь выбирает Engine = Codex или Engine = Auto.
7. Synvox создаёт TaskState до старта provider process.
8. HarnessAdapter запускает Codex как дочерний процесс в workspace проекта.
9. Machine-readable stdout разбирается построчно и преобразуется в SynvoxEvent.
10. UI показывает прогресс задачи, tool calls, изменённые файлы и verification state.
11. После завершения worker phase Verifier проверяет success criteria.
12. Только после успешной verification задача получает статус `completed`.
13. Provider session reference сохраняется отдельно от TaskState для возможного resume.

Технический поток:

    User task
        -> Task Orchestrator
        -> TaskState created
        -> Workspace policy check
        -> Codex capability/auth check
        -> HarnessAdapter
        -> Codex CLI process
        -> native structured events
        -> CodexEventParser
        -> SynvoxEvent stream
        -> TaskState checkpoints
        -> Verifier
        -> completed OR repair loop

Целевая граница ответственности:

    Synvox owns:
      task goal
      success criteria
      workspace permissions
      checkpoints
      event history
      verification
      provider routing

    Codex CLI owns:
      ChatGPT/OpenAI authentication
      provider session internals
      native agent loop
      native model communication
      native provider credentials

Synvox не должен извлекать токен из native Codex storage ради того, чтобы самостоятельно повторять HTTP-запросы к OpenAI. Если задача запущена через Codex backend, все provider-запросы идут через официальный CLI runtime.

### 17.14 Предлагаемый внутренний API Codex backend

Capability layer:

    detectCodex(): {
      installed,
      executable,
      version,
      machineOutputSupported,
      resumeSupported
    }

Auth layer:

    getCodexAuthStatus(): authenticated | required | unknown
    startCodexLogin(): ChildProcessHandle

Task adapter:

    runCodexTask({
      taskId,
      prompt,
      workspace,
      permissions,
      model,
      providerSessionId,
      signal
    }): AsyncIterable<SynvoxEvent>

Этот API намеренно не содержит accessToken/cookies. Provider credentials не входят в контракт Synvox.

### 17.15 Как Codex будет сосуществовать с текущим ChatGPT Web

На первом этапе это два разных backend'а:

    chatgpt-web
      обычный ChatGPT внутри Synvox
      browser/Camoufox transport
      полезен для общего диалога и текущей совместимости

    codex-cli
      coding-agent backend
      native CLI auth
      structured execution
      Harness TaskState / checkpoints / verification

Не нужно сразу удалять ChatGPT Web. После реальных измерений можно решить, какие coding-сценарии полностью перевести на Codex CLI, а какие оставить на browser transport.

### 17.16 Как Harness изменит текущий /code

Текущий code-agent loop постепенно становится Worker implementation, а не владельцем всей задачи.

Сейчас концептуально:

    user -> /code loop -> provider -> tools -> finish

После Harness:

    user
      -> TaskState
      -> Planner/criteria
      -> Worker (current /code, Qwen, Codex CLI, etc.)
      -> Checkpoint
      -> Verifier
      -> repair if needed
      -> finish

Это позволяет менять provider во время одной задачи без потери самой задачи.

Пример переключения:

    TaskState: Fix Qwen quota
      current step: implement
      changed files: account-session.mjs, account-manager.mjs
      focused tests: 22/22 passed

    Qwen hits confirmed quota
      -> save checkpoint
      -> Engine Auto selects Codex
      -> compact handoff from TaskState
      -> Codex continues current step

Ключевой принцип: переключается Worker, но не создаётся новая логическая задача.

### 17.17 Первый UI, который стоит сделать

Coder panel:

    Engine: Auto | Qwen | Codex | ChatGPT Web | GLM

    Goal: Fix false Qwen quota

    Steps:
      done     Inspect
      done     Reproduce
      done     Regression test
      running  Implement
      pending  Verify

    Worker: Codex
    Session: active
    Verification: pending

Provider settings:

    OpenAI Codex
    CLI: not installed / ready
    Auth: required / connected
    Version: detected version
    Machine events: yes / no
    Resume: yes / no

    Actions:
      Install / Connect / Reconnect / Check

На первой версии не нужны отдельные Planner/Reviewer окна. Пользователь должен видеть задачу, текущий шаг, worker и проверку результата.

### 17.18 Что делать следующим технически

Порядок реализации после текущих Qwen-фиксов:

1. Добавить `src/harness/task-state.mjs` и тесты жизненного цикла TaskState.
2. Добавить versioned `SynvoxEvent` schema и parser fixtures.
3. Добавить `src/harness/adapters/codex-cli.mjs` с dependency injection для spawn, чтобы unit-тесты не требовали установленного Codex.
4. Добавить `src/providers/codex/capability.mjs`.
5. После установки pinned Codex CLI на dev-машине зафиксировать реальные команды login/exec/resume и sanitized JSON fixtures.
6. Подключить один Codex task end-to-end без multi-agent routing.
7. Добавить deterministic Verifier.
8. Добавить persistence/checkpoint + resume.
9. Только затем включить Engine = Auto и переключение Qwen <-> Codex.
10. Planner/Reviewer и другие CLI agents подключать после стабильности single-worker Harness.

## 18. Актуальный порядок внедрения — 2026-10-01

### 18.1 Решение пользователя и сверка кода

Первый этап использует существующие Qwen, DeepSeek, GLM, ChatGPT Web и Google AI adapters. Внешний `harness-cli` сейчас не устанавливаем: он нормализует запуск CLI-агентов и не заменяет browser transport, AccountManager, skills или память SYNVOX. Существующая Codex app-server интеграция также обёрнута общим runner, но не является приоритетным backend этого этапа.

В SYNVOX уже есть code-agent loop, checkpoints отдельных провайдеров, Memory Core, skills/plugins и loader `SKILL.md`. Дублировать эти механизмы не требуется. В отличие от прежней общей схемы, сохраняем существующую проектную память; переносим управление логической задачей в общий TaskState. Нативные provider sessions остаются у adapters.

### 18.2 Шаги и критерии

1. **Контекст разработки и исследование.** Общий `docs/development/INDEX.md` и краткие файлы направлений. Читать нужный файл по задаче, подробности — по мере необходимости; после работы обновлять текущие факты и проверки. Готово локально.
2. **TaskState и события.** Цель, статус, provider/workspace/session/account references, checkpoint и versioned events. Сохранение через существующий conversation state. После рестарта created/queued/running переходят в interrupted без автоматической отправки запросов. Реализовано локально; окончательные проверки ниже.
3. **Подключение существующих workers.** Общий wrapper во всех code-agent путях пяти providers. «Продолжи» использует checkpoint той же задачи. Другой provider/workspace требует будущего handoff. Ошибка, отмена и ожидание пользователя не считаются completed. Реализовано локально; live provider smoke ещё не проведён.
4. **Проверка первого этапа.** Focused tests на каждый provider, реальные worker checkpoints без сети, serialization/restart, guard повторного действия, полный npm test, CI mirrors/build. Готово локально: полный `npm test` 1001/1001, CI invariants/build passed; focused scenarios покрывают scheduler, command resources, skills и Verifier. Live smoke пяти providers ещё не выполнен.
5. **Надёжное восстановление.** Общий error/delivery contract: auth_required, rate_limited, challenge_required, transport_error, unknown_delivery. Широкие Qwen 403/HTML checks исправлены с regression tests. Общий classifier и Qwen 403/HTML regressions реализованы локально. Для unknown delivery blind resume запрещён. Command timeout/stop с принудительным завершением проверен. History recovery всех provider transports ещё не унифицирован.
6. **Verifier + handoff + аккаунты.** Детерминированная проверка результата, AccountManager для пяти providers с максимумом 10 identities, изоляция profiles, leases и лимиты concurrency. Verifier реализован через `verify_task`: 1–5 проверок последовательно, существующие permissions/owner approval, реальные exit outcomes; изменения сбрасывают verification. AccountManager/handoff остаются следующими этапами. Resume в новой сессии должен использовать bounded handoff без переноса чужого parent ID.
7. **Постоянные агенты и UI.** Карточка агента: роль, workspace, skills, память, задания и статус. Пользователь описал идею агентов в «dots», точный внешний продукт ещё не установлен. Начать с одного агента; независимый read-only reviewer и planner добавить после стабильного worker.

### 18.3 Полезные дополнения: что брать и когда

| Возможность | Что подтверждено источниками | Решение для SYNVOX |
|---|---|---|
| Agent Skills | `SKILL.md`, scripts/references/assets, progressive disclosure | Реализованы metadata-only catalog/auto-match, `load_skill` и bounded resources по требованию; существующий loader сохранён |
| MCP | Стандарт обмена tools/resources/prompts, local stdio и remote HTTP | Собственный browser MCP server уже есть; общий MCP **client** — отдельный следующий этап |
| Hooks | Детерминированные события до/после tool и при завершении | Начать с встроенных проверок policy/checkpoint/verification; произвольные shell hooks не включать автоматически |
| Handoff/context compaction | Progress notes и structured state помогают продолжать работу между sessions | Общий указатель + файлы направлений + task checkpoint; не передавать всю историю на каждый шаг |
| Verifier/evaluator | Evidence gate и отдельный evaluator дают проверяемый цикл | Сначала тестовые команды и артефакты; reviewer не заменяет автоматические проверки |
| Worktrees/sandbox | Разделение рабочих каталогов полезно для независимых workers | Worktree не является OS sandbox; позже ownership файлов, diff и разрешённый merge |
| Управление стоимостью | Native usage events полезны, если backend их предоставляет | Показывать известные usage/лимиты, неизвестное оставлять неизвестным; не выдумывать стоимость Web providers |

### 18.4 Ограничения первого этапа

Event journal ограничен последними 100 событиями, sequence непрерывен; это не полный event-sourced replay. В чате хранится последняя TaskState; долгосрочный архив задач отдельной сущностью пока не введён. `verification: not_run` сохраняется без явных checks; `verify_task` фиксирует passed/failed отдельно от worker finish, изменения сбрасывают результат. Ожидание модели не доказывает доставку: после неизвестного прерывания требуем проверки, не повторяем вслепую. Прерванный tool также требует проверки проекта. Automatic account/provider failover, universal CAPTCHA solving и новый UI пока не реализованы. Worker gate допускает два активных workers и 16 queued без polling, но browser admission до gate и idle cleanup ещё нужны. Для всей программы требуются отдельные CPU/RSS замеры; отсутствие высокой нагрузки не заявляется по unit tests.

### 18.5 Первичные источники исследования

Проверено 2026-10-01. Возможности конкретных версий нужно проверять pinned fixtures до установки.

- [Harness architecture](https://www.harness.lol/docs/reference/architecture), [events](https://www.harness.lol/docs/reference/events), [source/README](https://github.com/ayshptk/harness-cli). Документация architecture перечисляет 7 events, актуальный README — 8 с UsageDelta: собственный schema и version pin обязательны.
- [Agent Skills specification](https://agentskills.io/specification) и [client implementation](https://agentskills.io/client-implementation/adding-skills-support): каталог metadata → activation → resources; project/user scopes.
- [OpenAI skills](https://learn.chatgpt.com/docs/build-skills), [Codex App Server](https://learn.chatgpt.com/docs/app-server): существующая интеграция app-server пригодна для native thread resume; новые capabilities не считать доступными в закреплённой версии без проверки.
- [MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture): протокол не определяет orchestration или память приложения.
- [Anthropic: effective harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents): incremental progress, progress file и проверка features.
- [Anthropic example quality loop](https://github.com/anthropics/cwc-long-running-agents): evidence gate, evaluator и handoff; пример hooks не является готовым production контролем.
- [Claude Code hooks](https://code.claude.com/docs/en/hooks): lifecycle и pre-tool decisions. Это vendor hooks; для пяти текущих SYNVOX backends нужен свой общий contract.


### 18.5 Автопродолжение — 2026-10-02, Codex, локально

Принято пользователем: заменить ручное «продолжи» автоматическим восстановлением после временной паузы. Общий runner включён для существующих workers пяти Web-провайдеров. `auto-continue.mjs` разрешает повтор только с ready/awaiting_model checkpoint и transport evidence rejected/not_sent при quota/transport error. Две дополнительные попытки: 60/120 секунд; provider delay учитывается до 30 минут. Более длительное требование не сокращается до раннего resend. Auth/challenge/unknown delivery и executing_tool не запускают автоматический replay.

Ожидание не занимает scheduler slot и использует отменяемый таймер. Task ID и последний checkpoint сохраняются; `autoResumeAttempts`/`nextResumeAt` записываются в state. UI сообщает срок и номер попытки, «Стоп» отменяет ожидание. Отдельные внешние Qwen/DeepSeek cooldown loops удалены из window server, чтобы бюджеты не умножались. Provider/workspace/task replacement прекращает продолжение. Task-runner продлевает stale deadline через подтверждённое ожидание, а действительно stale worker получает abort перед удалением.

Рестарт очищает незавершённый timer deadline и помечает задачу interrupted; автоматический запуск сохранённых задач после открытия приложения пока не реализован. Новый code-only rate error без delivery/status считается unknown. DeepSeek rate hint после partial content/message ID тоже unknown. Исправлен catch после failed Verifier, который раньше мог скрывать исходное исключение через ReferenceError.

Проверки: 56 focused tests, включая реальный code-agent с записью файла и quota/recovery без повторного write; отмена, исчерпание бюджета, задержка provider, long-delay guard, контекст/restart и partial delivery. Full `npm test`: 1017/1017; VS Code build и `npm run check:ci` passed. Live provider smoke не выполнялся. Изменения не опубликованы.
