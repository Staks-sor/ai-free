# Qwen: меню, сессия и штатная отправка

2026-10-13, Codex. `main/3db7d9c`, незакоммичено/не опубликовано. Главный SYNVOX не перезапускался; только разрешённая диагностика Qwen.

## Подтверждённые причины

1. Camoufox ru-RU переводит menu/mode/Send/search; English selectors не находили меню, повторный toggle закрывал его.
2. getAccountById фильтрует expired/invalid: browser factory теряла profileDir и открывала fallback без входа.
3. SSR guest header появляется до пользователя. Новый token manager читает qwen_access_token_state version1 раньше legacy token; прежний seed обновлял только token. Поздний API GET подтвердил unauthorized/Token has expired.
4. Пустой API-чат перенаправляется на homepage. Native Send создаёт другой ID через XHR, затем completion через fetch; fetch-only attestation пропускала создание.
5. HTTP200/SSE internal_error мог возвращаться через успешный completion как текст ошибки.

## Изменения

`native-composer.mjs`: structural popup/RU–EN labels, bounded selection/Stop/full draft. Proven empty root attests fetch/XHR creation с exact model/successful data.id; completion ждёт bridge ack. Body/headers/события не переписываются. Stop aborts creation; duplicate/concurrent Send заблокирован, первый ответ сохраняется; wrappers восстанавливаются.

`auth-files.mjs`: seed согласует raw/native state/at_expire_time, выбирая newer JWT; invalid/expired не получает future-valid state. Markers/settings сохраняются. `browser-proxy.mjs`: raw profile metadata, bounded guest hydration <=10секунд с Stop/valid JWT, typed auth/not_sent. Root homepage, existing /c/id; bridge сохраняет ID при challenge/Stop.

`client.mjs`, `account-session.mjs`: original ID/null parent проверяются; actual ID переносится через recoveredChatId/error.qwenTurn/onSession/checkpoint. Structured SSE/JSON error теперь QWEN_UPSTREAM_ERROR/rejected с upstreamCode. Обычный текст и secondary A/B error не считаются ошибкой primary. Branch guards/no blind replay сохранены. Desktop/VS Code совпадают.

## Проверки

Locale/profile/auth/root/XHR/concurrent/stream failure: red→green. Последний focused run6 файлов:61/61; new native-stream-failure3/3. Изолированный `node --test --test-concurrency=2 --experimental-test-coverage --test-reporter=./scripts/coverage-reporter.mjs test/*.test.mjs`:1490/1490,189 suites/16 gates PASS. `npm run check:ci`, sync/build/byte comparisons/diff PASS.

Live через fresh QwenChatClient в SYNVOX/Camoufox ru-RU: штатный менеджер обновил сессию того же account ID. Qwen3.8-Max: POST1, HTTP200, точный SYNVOX_LOCALE_OK, primary response ID/native new-chat ID подтверждены. Secondary A/B internal_error игнорируется. Reload чата: current assistant done/error=false, следующий Send доступен; временный draft восстановлен. Исходные failed task/QWEN_NATIVE_UI_UNAVAILABLE и awaiting_model checkpoint сохранены. Inspector закрыт; CAPTCHA не решалась.

Preview `output/qwen-locale-fix-20261013/working-package/synvox-desktop-preview.zip`:280 matching runtime files; SHA256 f9c9d8748dba1aafbc0d83d28d10c732d0a220b9eb11b3197d25fe66af7842ed, verification.json.

Остаток: ручной полный restart для cached classes, затем пользовательский Continue. Long coding/другие модели/режимы/Windows/Linux не проверены.
