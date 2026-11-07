# Qwen JWT Silent Refresh — патч для ai-free 0.4.25

## Проблема
Qwen использует **двухуровневую систему токенов** в `localStorage`:
1. `localStorage["token"]` — 14-дневный session token (Qwen API его НЕ принимает для запросов, вызывает антибот-капчу или 401).
2. `localStorage["qwen_access_token_state"]` — JSON с полем `token`, внутри которого лежит **настоящий 15-минутный access_token** (type:"access_token", TTL=900s).

Оригинальный ai-free 0.4.25 читал только `localStorage["token"]` (14-дневный), из-за чего:
- Первый запрос после логина работал (т.к. SPA временно принимала session token)
- Через 15 минут протухал настоящий access_token, но ai-free этого не замечал
- При тяжёлой задаче (несколько запросов подряд) Qwen отзывал сессию → окно логина

## Решение
Патч читает **настоящий access_token** из `qwen_access_token_state.token` и использует именно его для API запросов и в `auth.json`.

Также патч добавляет:
- Proactive timer (раз в минуту проверяет `exp`, за 90с до протухания делает silent refresh через SPA reload)
- Запуск timer при старте сервера (`api/server.mjs`)
- Корректную обработку 401 с `force: true` (игнорирует `exp`, принудительно делает `page.reload()`)
- Механизм подписки клиентов (`registerClient`/`_notifyClients`) на обновление токена
- Сериализацию `page.reload()` через `worker.queue` (не ломает активные запросы)
- Рекурсивный `setTimeout` вместо `setInterval` (стабильно на Windows)

---

## Установка

### 1. Распакуй архив
```bash
unzip qwen-fix.zip -d qwen-fix
```

### 2. Куда копировать файлы (ОБЯЗАТЕЛЬНО совпадает с путями ниже!)

| Файл в архиве | Куда копировать в проекте ai-free |
|---|---|
| `auth-manager.mjs` | `src/providers/qwen/auth-manager.mjs` |
| `browser-login.mjs` | `src/providers/qwen/browser-login.mjs` |
| `browser-proxy.mjs` | `src/providers/qwen/browser-proxy.mjs` |
| `server.mjs` | `src/window-app/server.mjs` |
| `openai-handler.mjs` | `api/openai-handler.mjs` |
| `openai-server.mjs` | `api/server.mjs` |
| `acp-server.mjs` | `src/acp/server.mjs` |
| `README.md` | — (не копируется, это инструкция) |

### 3. Команды для копирования

**Linux / macOS:**
```bash
cp qwen-fix/auth-manager.mjs      /path/to/ai-free/src/providers/qwen/
cp qwen-fix/browser-login.mjs    /path/to/ai-free/src/providers/qwen/
cp qwen-fix/browser-proxy.mjs    /path/to/ai-free/src/providers/qwen/
cp qwen-fix/server.mjs            /path/to/ai-free/src/window-app/
cp qwen-fix/openai-handler.mjs    /path/to/ai-free/api/
cp qwen-fix/openai-server.mjs     /path/to/ai-free/api/server.mjs
cp qwen-fix/acp-server.mjs        /path/to/ai-free/src/acp/server.mjs
```

**Windows (PowerShell):**
```powershell
Copy-Item .\qwen-fix\auth-manager.mjs    -Destination C:\Users\12\ai-free\src\providers\qwen\ -Force
Copy-Item .\qwen-fix\browser-login.mjs  -Destination C:\Users\12\ai-free\src\providers\qwen\ -Force
Copy-Item .\qwen-fix\browser-proxy.mjs  -Destination C:\Users\12\ai-free\src\providers\qwen\ -Force
Copy-Item .\qwen-fix\server.mjs          -Destination C:\Users\12\ai-free\src\window-app\ -Force
Copy-Item .\qwen-fix\openai-handler.mjs  -Destination C:\Users\12\ai-free\api\ -Force
Copy-Item .\qwen-fix\openai-server.mjs   -Destination C:\Users\12\ai-free\api\server.mjs -Force
Copy-Item .\qwen-fix\acp-server.mjs      -Destination C:\Users\12\ai-free\src\acp\server.mjs -Force
```

### 4. Проверь, что патч применился (поиск по файлу)

В `browser-proxy.mjs` по Ctrl+F найди `qwen_access_token_state` — должно быть **3 совпадения** (в `proxyFetch`, `proxyFetchStream` и `reloadAndCaptureFreshToken`).

Если меньше — файл не обновился или обновился не до конца.

---

## .bat-файл для запуска (Windows)

```batch
@echo off

netstat -ano | findstr :4318 >nul
if %errorlevel%==0 (
    echo Сервер уже запущен на порту 4318.
    pause
    exit /b
)

cd /d D:\MyProjects\ai-free-0.4.25

REM Устанавливаем переменные окружения
set DEEPSEEK_DEBUG_QWEN=1
set QWEN_REFRESH_SKEW_SEC=300

REM Запускаем API сервер
npm run api

pause
```

**Где:**
- `DEEPSEEK_DEBUG_QWEN=1` — включает логи `[qwen-auth]` и `[qwen-proxy]` (можно убрать, когда всё работает)
- `QWEN_REFRESH_SKEW_SEC=300` — запускать silent refresh за 5 минут до протухания (можно убрать, по умолчанию 90с)

---

## Как проверить, что патч работает

### 1. При первом запросе к Qwen
```
[qwen-auth] proactive refresh timer started, interval=60s
[API] POST /v1/chat/completions (model: qwen3.8-max)
[qwen-auth] trying silent refresh from profile…
[qwen-refresh] using active browser-proxy for SPA reload…
[qwen-proxy] reloadAndCaptureFreshToken: got fresh token after 0s
🔄 Qwen auth refreshed silently from saved profile.
[qwen] server-issued chat_id: ...      ← УСПЕХ!
[qwen-auth] proactive tick: token still valid (850s left), skip    ← 15 минут!
```

**Ключевая проверка:** TTL должен быть **~850-900s** (15 минут), а НЕ 1254373s (14 дней).

### 2. Через 14 минут
```
[qwen-auth] proactive tick: token near expiry, refreshing…
[qwen-refresh] using active browser-proxy for SPA reload…
[qwen-proxy] reloadAndCaptureFreshToken: got fresh token after 0s
🔄 Qwen auth refreshed silently from saved profile.
[qwen-auth] proactive tick: token still valid (890s left), skip
```

### 3. При тяжёлой задаче (несколько запросов подряд)
```
[API] POST /v1/chat/completions (qwen3.8-max)
[qwen] server-issued chat_id: ...      ← УСПЕХ, без 401 и без капчи
[API] POST /v1/chat/completions (qwen3.8-max)
[qwen] server-issued chat_id: ...      ← снова успех
```

---

## Если что-то не работает

### 1. Капча `RGV587_ERROR::SM::哎哟喂,被挤爆啦`

Это **антибот-защита Qwen (Alibaba WAF)**. Это значит, что Qwen решил, что вы бот. Причины:
- Слишком много запросов подряд
- Сменился IP (перезагрузили роутер)
- Подозрительный user-agent
- Qwen временно ограничил аккаунт

**Что делать:**
- Подождать 15-30 минут (обычно снимается сама)
- Открыть `chat.qwen.ai` в обычном браузере, залогиниться там (возможно, потребуется решить капчу)
- Если совсем не работает — подождать до завтра, Qwen обычно снимает блокировку через 24ч

### 2. Окно логина открывается после тяжёлой задачи

Это значит, что Qwen отозвал **refresh_token** (не только access_token). Silent refresh не может обновить токен, потому что refresh_token тоже отозван.

**Что делать:**
- Залогиниться вручную через Google OAuth
- После этого патч снова будет обновлять токен автоматически

### 3. Не появляется `[qwen-auth] proactive refresh timer started`

Проверь:
- `api/server.mjs` обновлён (это файл `openai-server.mjs` в архиве)
- Запускаешь именно `npm run api` (а не `npm start`)
- Включён `DEEPSEEK_DEBUG_QWEN=1`

### 4. TTL показывает 14 дней (а не 15 минут)

Значит `browser-proxy.mjs` не обновился. Проверь, что в файле **3 совпадения** `qwen_access_token_state` (через Ctrl+F).

---

## Состав архива (7 файлов)

| Файл | Размер | Назначение |
|---|---|---|
| `auth-manager.mjs` | ~14 KB | Proactive timer + silent refresh + `registerClient`/`_notifyClients` |
| `browser-login.mjs` | ~30 KB | Чтение `qwen_access_token_state.token` + fallback на `localStorage["token"]` |
| `browser-proxy.mjs` | ~37 KB | Чтение правильного токена в `proxyFetch` + `reloadAndCaptureFreshToken` |
| `server.mjs` | ~128 KB | Десктоп (`npm start`) — запуск proactive timer |
| `openai-handler.mjs` | ~65 KB | API сервер (`npm run api`) — retry с `force: true` при 401 |
| `openai-server.mjs` | ~6 KB | API сервер — запуск proactive timer при старте |
| `acp-server.mjs` | ~11 KB | ACP (PyCharm) — регистрация клиента в менеджере |
| `README.md` | — | Эта инструкция |

---

## Дополнительные env-переменные (опционально)

```bash
QWEN_PROACTIVE_REFRESH_INTERVAL_MS=60000   # интервал проверки, по умолчанию 60с
QWEN_REFRESH_SKEW_SEC=300                    # запускать refresh за 300с (5мин) до протухания
DEEPSEEK_DEBUG_QWEN=1                        # подробные логи
```

---

## Что НЕ менялось

- `auth-files.mjs` — без изменений
- `client.mjs` — без изменений
- `session-errors.mjs` — без изменений
- `config.mjs` — без изменений

---

## Архитектура решения (финальная)

```
Запрос к Qwen
        │
        ▼
getQwenClient() / getOrCreateQwenClient()
        │
        ├─ ensureQwenAuth() / readQwenAuth()
        │   ├─ Если auth.json существует → проверить isQwenJwtExpired(token)
        │   │   ├─ Токен валиден → return existing
        │   │   └─ Токен протух → silent refresh
        │   └─ Если auth.json нет → silent refresh
        │
        ├─ new QwenChatClient({token: НАСТОЯЩИЙ access_token})
        │
        └─ getQwenAuthManager() ← запуск proactive timer
            └─ registerClient(qwenClient) ← подписка на refresh
                │
                ▼
        Proactive timer (каждую минуту):
        ┌─────────────────────────────────────────────┐
        │ read auth.json                                │
        │ decode exp                                    │
        │ if (exp - now > skew) → SKIP                  │
        │ else → _doRefresh({ allowVisible: false })    │
        │   ├─ refreshQwenAuthFromProfile()              │
        │   │   ├─ isQwenBrowserProxyActive() → true    │
        │   │   └─ proxy.reloadAndCaptureFreshToken()   │
        │   │       └─ читаем qwen_access_token_state   │
        │   │           .token (15-минутный)            │
        │   ├─ _notifyClients(auth)                     │
        │   │   └─ qwenClient.setAuth({newToken})        │
        │   └─ write auth.json                          │
        └─────────────────────────────────────────────┘

При 401 от API:
        │
        ▼
retry с force: true (игнорируем exp, делаем page.reload())
        │
        ├─ SPA обновила access_token в qwen_access_token_state
        │   └─ retry → 200 OK ✅
        │
        └─ SPA не смогла (refresh_token отозван)
            └─ visible login (нужно залогиниться вручную)
```

---

## Главный вывод

**`localStorage["token"]` (14 дней) ≠ access_token.** Это session token, который Qwen API не принимает.

**Настоящий access_token лежит в `localStorage["qwen_access_token_state"].token`** (15 минут, type:"access_token").

Патч читает именно его, и теперь:
- API запросы проходят с правильным токеном
- Proactive refresh обновляет именно 15-минутный access_token (а не 14-дневный session token)
- Тяжёлые задачи больше не вызывают 401 (потому что токен правильный)

Если Qwen всё равно показывает капчу — это уже не баг патча, это антибот-защита Qwen. Подождите 15-30 минут (или до завтра) и попробуйте снова.
