# Провайдеры и аккаунты

Обновлено: 2026-11-07, Codex. `main/3db7d9c`; исходники незакоммичены, Desktop0.5.60 опубликован.

## Карта

Каталог моделей: [MODELS.md](MODELS.md). Web-аккаунты используют `providers/account-registry.mjs`, `web-account-manager.mjs` и `web-account-adapters.mjs`; Qwen — `providers/qwen/account-manager.mjs`. Маршруты: `window-app/account-routes.mjs`. У каждого аккаунта изолированы auth/profile/storage/fingerprint/affinity/session; CAS leases не дают одновременно открыть профиль из Desktop и IDE. Детали: `AUDIT_RECHECK_FIXES-2026-10-13.md`.

## Qwen

`native-composer.mjs`, `browser-proxy.mjs`, `client.mjs`, `account-session.mjs` отправляют штатный composer turn и читают SSE. Guards сверяют chat/model/parent/prompt и запрещают второй Send. Proven empty root attests `/chats/new`; новые chat IDs проходят через success/error/session/checkpoint. Native body и headers сохраняются, SSE clone идёт в parser. Ошибки native UI, CAPTCHA и неоднозначная доставка сохраняют точный checkpoint: blind retry, fresh-chat fallback и повторная отправка запрещены.

Recovery читает авторизованную историю и DAG. Non-root absence требует закрытый transport, не менее пяти минут и завершённый DAG; challenge не переотправляется автоматически. Image turn восстанавливается только при точном совпадении provider file IDs. Auth сохраняет identity/newer JWT/refresh token; guest и CAPTCHA блокируют подтверждение. Worker pool, leases, Stop, Retry-After и session affinity сохранены. Подробности: `QWEN_MODE_FIX-2026-10-13.md`, `QWEN_CAPTCHA_FIX-2026-10-13.md`.

`files[]` URL (`file_class: url`) исключаются из image count/identity при capture/harvest. Text+URL/image+URL/recovery:50/50; детали в `VISION.md`.

## Изображения

Transport/agent contract, пути и принятые проверки: [VISION.md](VISION.md). Antigravity vision не поддерживается.

## Перенос на сервер

Portable cookies/origin storage восстанавливаются в пустой профиль один раз; существующий не перезаписывается. GLM закрывает onboarding tour. Проверки сервера: [SERVER_API.md](SERVER_API.md).

## Состояние

0.5.62: постоянный Qwen profile, Python3.10+/setup diagnostics, независимые provider login jobs и readiness transport/not_sent без logout. Предыдущая реальная coder приёмка3/3→6/6 после restart: `QWEN_CODER_ACCEPTANCE-2026-11-06.md`.

0.5.63 (7 ноября): `browser/login.mjs` различает hCaptcha unknown/false/true, фильтрует error-codes; adapters/web-account-manager передают progress в настройки. CAPTCHA не заменяет авторизованную сессию. `browser/camoufox-runtime.mjs` ограничивает export5с, пишет snapshot атомарно0600; context close5с → собственный Browser35с. Идемпотентный close, поздние snapshots отбрасываются, полное зависание даёт CAMOUFOX_CLOSE_TIMEOUT/повтор. `qwen/browser-login.mjs` пишет success после закрытия, показывает closing и не скрывает cleanup errors; qwen manager сохраняет progress, игнорирует поздние callbacks. DeepSeek показывает closing. Desktop/VSCode синхронизированы.

Red→green8 regressions; full1730/1730,193 suites/16 gates, CI/build/diff PASS. Native Camoufox portable/persistent localStorage/cookie restart PASS; injected export/context-close hangs восстановлены примерно5.2с с сохранением snapshot и отключением собственного browser. UI closing1280/360 без overflow. Пакеты0.5.63 подготовлены, незакоммичено; публикация владельцем. Приёмка/границы: `../RELEASE-0.5.63.md`. Клиент уточнён: Windows11Pro26H2, Desktop0.5.60; видео показывает Qwen readiness45с timeout и DeepSeek CAPTCHA retry до авторизации. Для Desktop подготовлен отдельный ZIP0.5.63; реальная CAPTCHA Windows не воспроизведена. Внешние ограничения не обходятся.
