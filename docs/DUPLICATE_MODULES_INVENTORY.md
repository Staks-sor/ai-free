# Инвентаризация дублирующихся модулей (Desktop & VS Code)

Документ фиксирует результаты выполнения **Этапа 3 (PR-4)** из [Плана устранения технических рисков](TECHNICAL_RISK_REMEDIATION_PLAN.md).

## 1. Сводные метрики

- **Всего просканировано:** 162 файла в Desktop (`src/`, `api/`) и 158 файлов в VS Code (`plugin-for-vscode/src/`, `plugin-for-vscode/api/`).
- **Полностью идентичные модули:** 156 файлов (1.45 MB исходного кода и ресурсов, синхронизированных байт-в-байт).
- **Платформенно-специфичные модули (намеренные различия):** 2 файла.
- **Модули только для Desktop:** 4 файла (`src/agent-team/*`).
- **Модули только для VS Code:** 0 файлов.
- **Случайно разошедшиеся модули (Divergent):** 0 файлов.

---

## 2. Платформенно-специфичные модули (Матрица различий)

| Модуль | Desktop реализация | VS Code реализация | Причина различия |
|---|---|---|---|
| `src/state/window-state.mjs` | Содержит поле `mainAgentId` в функции `normalizePipeline` | Поле `mainAgentId` опущено | Desktop поддерживает мультиагентные пайплайны и назначение главного агента |
| `src/window-app/web-browser.mjs` | Headless Playwright контекст | Headed Chrome с координатами `--window-position=-32000,-32000` | В VS Code браузер отображается внутри Webview редактора и требует headed контекста |

---

## 3. Модули только для Desktop

Следующие модули используются только в Desktop-версии приложения и отсутствуют в VS Code расширении:
- `src/agent-team/index.mjs` — Точка входа подсистемы мультиагентных команд.
- `src/agent-team/roles.mjs` — Определение ролей агентов в команде.
- `src/agent-team/team-manager.mjs` — Управление жизненным циклом команды агентов.
- `src/agent-team/team-runner.mjs` — Исполнение задач в мультиагентном режиме.

---

## 4. Кандидаты для выноса в `packages/core` (Этап 4 / PR-5)

Модули сгруппированы по приоритету безопасности миграции (от чистых утилит к более сложным подсистемам):

### Группа 1: Каталог моделей и абстракции провайдеров (2 файла)
- `providers/model-catalog.mjs` — Единый каталог моделей всех поддерживаемых провайдеров.
- `providers/registry.mjs` — Реестр провайдеров.

### Группа 2: Локализация и языковые ресурсы (12 файлов)
- `i18n/index.mjs`
- `i18n/agent-roles.mjs`
- `i18n/command-descriptions.mjs`
- `i18n/languages/*.mjs` (ar, de, en, es, fr, hi, pt, ru, zh)

### Группа 3: Чистые алгоритмы памяти и поиска (6 файлов)
- `memory/markdown.mjs` — Парсер и сериализатор Markdown frontmatter.
- `memory/search/embed.mjs`
- `memory/search/fts-query.mjs` — Построитель FTS5 запросов.
- `memory/search/hybrid.mjs` — Слияние результатов поиска.
- `memory/search/keyword.mjs`
- `memory/search/vector.mjs`

### Группа 4: Парсеры и протокольные утилиты кодового агента (3 файла)
- `code-agent/parser.mjs` — Парсер tool calls из текста модели.
- `code-agent/tool-log.mjs` — Форматирование логов инструментов.
- `code-agent/loop-helpers.mjs` — Промпты восстановления цикла агента.

### Группа 5: Сервис распознавания речи (1 файл)
- `stt/service.mjs` — Движок локального STT (Parakeet V3).

---

## 5. Автоматизированный контроль в CI

Для предотвращения случайной рассинхронизации идентичных модулей добавлен скрипт `scripts/inventory-duplicates.mjs`.

- Проверка инвариантов запускается автоматически при `npm run check:ci`:
  ```bash
  node ./scripts/inventory-duplicates.mjs --check
  ```
- Генерация отчёта:
  ```bash
  npm run inventory
  ```
