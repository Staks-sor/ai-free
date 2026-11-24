# Восстановление без ложного входа и повторной отправки

2026-10-02, Codex, main/3db7d9c. Локальные изменения, без публикации.

## DeepSeek

`response-errors.mjs` проверяет JSON API, upload и completion. Generic HTTP 403 не доказывает истечение сессии: DEEPSEEK_ACCESS_DENIED, delivery=unknown, без refresh/replay. HTML challenge имеет приоритет даже на HTTP 401: isChallenge, без isAuthError. HTML без подтверждённой причины получает DEEPSEEK_UNEXPECTED_RESPONSE.

HTTP 401 без challenge или прежние точные JSON-коды 40002/40003 остаются auth evidence: DEEPSEEK_AUTH_REQUIRED, delivery=rejected. `_withReauth` разрешает до двух refresh только для isAuthError и rejected/not_sent. Сигнал Stop проверяется до попытки/refresh и после refresh; прекращает дальнейшую отправку. Auth preparation не полностью отменяемая. Общая пауза/Retry-After: `DEEPSEEK_REQUESTS.md`.

## Google AI

Убраны reset + sleep 15 s + повтор после отсутствия ответа: генерация могла уже начаться. Сообщение не обещает автоматическую повторную отправку. В `sendGoogleAIChatOnce` весь путь отмечает delivery: query-bearing goto считается потенциальной отправкой ДО навигации; composer submit — до вызова отправки. Ошибки до этих действий получают not_sent, после — unknown/promptSubmitted=true.

Клиент повторяет распознанный transport failure один раз только при not_sent и отсутствии submission. Ошибка proxyFactory до вызова sendChat имеет not_sent. Подтверждённый signed-out UI по-прежнему вызывает reconnect callback без повторного вопроса. Пауза между обычными Google turns остаётся прежней, локальной внутри browser proxy.

## GLM

`sendGLMChatOnce` и callback `submitGLMPrompt` отмечают попытку отправки ДО click/Enter. Workflow сохраняет delivery. Обычный timeout клика не разрешает второй клик/Enter. Исключение: явный pointer interception и успешно закрытая видимая overlay — существующее безопасное восстановление; второй неоднозначный сбой выходит наружу.

Клиент повторяет только not_sent preparation failure. Новизна ответа определяется по ID сообщения/count/text: два одинаковых текста подряд не вызывают таймаут. Snapshot считает внешний assistant контейнер один раз, исключает пользователя и anchors. Thought Process без «Итог» также удаляется. Подтверждено реальным повторяющимся ответом в одном диалоге (`LIVE_ACCEPTANCE.md`).

## ChatGPT

Сигнал Stop передаётся coding adapter → client → browser proxy. Проверки до отправки, после подготовки и в цикле наблюдения; при отмене после submission доступная кнопка Stop вызывается без закрытия сессии. Подготовка браузера не полностью отменяемая.

Один transport retry принадлежит клиенту, только при явном not_sent; browser/server больше не умножают повторы. Browser отмечает delivery даже при ошибке click/Enter. Server восстанавливает auth только до отправки; unknown submission не повторяется.

## Приёмка и продолжение

1147/1147 tests, 16 coverage gates, VS Code build, CI/mirrors/diff. Проверены auth/submission границы, отмена и передача сигнала. Реальные результаты: `LIVE_ACCEPTANCE.md`; DeepSeek/Google AI/ChatGPT ответили, GLM повторяющийся ответ пришёл после исправления, Qwen без входа. Без публикации.

Общие confirmed cooldown ChatGPT/GLM/Google AI, дополнительные resume пути, кеш/бюджет RAG и полная живая приёмка впереди. Не выводить блокировку/expiry из текста модели. План: `REQUEST_POLICY.md`.
