# OpenAI-совместимый API (прототип)

Локальный HTTP-сервер, имитирующий OpenAI API. Под капотом — наши клиенты к
**бесплатным** chat.qwen.ai и chat.deepseek.com.

Любой инструмент, поддерживающий «свой baseURL для OpenAI» (Continue.dev, Cursor,
Aider, Cline, ChatGPTBox, custom scripts), может работать через этот endpoint.

## Что реализовано в прототипе

- `GET  /v1/models` — список доступных моделей.
- `POST /v1/chat/completions` — non-streaming chat completion.
- Qwen-провайдер через невидимый Playwright-прокси (см. `src/providers/qwen/browser-proxy.mjs`).

## Что НЕ реализовано (TODO)

- Multi-turn через persistent sessionId. Сейчас вся история сжимается в один prompt
  на каждый запрос — это работает, но контекст хуже.
- Usage tokens (всегда 0 в ответе).

## Запуск

Сначала нужен подключённый Qwen (auth.json должен существовать):

```bash
# Один раз — логин в Qwen через Playwright
npm run login-qwen
```

Запуск API-сервера:

```bash
node api/server.mjs
# с debug:
API_DEBUG=1 node api/server.mjs
```

Сервер по умолчанию слушает **127.0.0.1:4318** (UI-сервер живёт на 4317 —
порты не конфликтуют, можно запускать оба одновременно).

## Тест из терминала

```bash
# Список моделей
curl http://127.0.0.1:4318/v1/models | jq

# Чат
curl http://127.0.0.1:4318/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "qwen3.6-plus",
    "messages": [
      {"role": "user", "content": "Привет, как дела?"}
    ]
  }' | jq
```

## Подключение в Continue.dev / Cursor / Aider

Используй кастомный OpenAI-совместимый провайдер. Параметры:

| Поле | Значение |
|------|----------|
| `baseURL` | `http://127.0.0.1:4318/v1` |
| `apiKey` | Bearer API key из настроек AI Free |
| `model` | `qwen3.7-max`, `qwen3.6-plus`, `qwen3-max`, `deepseek-v4-pro` и т.д. |

Пример для Continue.dev (`~/.continue/config.json`):

```json
{
  "models": [
    {
      "title": "Qwen3.7 MAX (local proxy)",
      "provider": "openai",
      "model": "qwen3.7-max",
      "apiBase": "http://127.0.0.1:4318/v1",
      "apiKey": "local"
    }
  ]
}
```

## Доступные модели

Список берётся из единого каталога `src/providers/model-catalog.mjs`.

| `model` в запросе | Провайдер | Внутреннее имя |
|-------------------|-----------|----------------|
| `qwen3.7-max`     | qwen      | qwen3.7-max    |
| `qwen3.6-plus`    | qwen      | qwen3.6-plus   |
| `qwen3-max`       | qwen      | qwen3-max      |
| `qwen2.5-plus`    | qwen      | qwen2.5-plus   |
| `qwq-32b`         | qwen      | qwq-32b        |
| `qwen-vl-max`     | qwen      | qwen-vl-max    |
| `deepseek-v4-flash` | deepseek | DEFAULT        |
| `deepseek-v4-pro` | deepseek  | expert         |
| `deepseek-v4-vision` | deepseek | vision        |
| `deepseek-chat`   | deepseek  | DEFAULT        |
| `deepseek-reasoner` | deepseek | expert        |

## Ограничения

- Каждый запрос создаёт **новый** Qwen-чат на стороне chat.qwen.ai. Это нагружает
  rate-limit бесплатного аккаунта быстрее, чем при работе через UI (где чат
  переиспользуется).
- Browser-proxy — singleton, один Chromium на весь процесс. Параллельные запросы
  обслуживаются последовательно (page.evaluate блокирует страницу).
- Качество multi-turn хуже из-за «сжатия» истории в один prompt. Решится с
  persistent sessionId.

## Архитектура

```
api/
├── server.mjs            # HTTP-сервер на 4318
├── openai-handler.mjs    # /v1/* endpoint-логика, перевод формата
├── models.mjs            # re-export единого каталога моделей
└── README.md             # ты сейчас читаешь
```

Использует существующие модули проекта:
- `src/providers/qwen/client.mjs` — QwenChatClient
- `src/providers/qwen/auth-files.mjs` — readQwenAuth
- `src/providers/qwen/browser-proxy.mjs` — невидимый Chromium (singleton)
