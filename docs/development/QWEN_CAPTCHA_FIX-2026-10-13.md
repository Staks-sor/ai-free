# Qwen: CAPTCHA, native replay и сохранённая задача

2026-10-13, Codex. main/3db7d9c; локально, незакоммичено/не опубликовано. Desktop/VS Code синхронизированы.

## Подтверждённые причины

Baxia оставляет hidden iframe #baxia-dialog-content: 0×0, ancestor display:none. Старый confirmation считал его видимой проверкой, несмотря на x5sec/GET200. Checkpoint GET отдельно возвращал HTTP200/success=false/unauthorized; ошибка трактовалась как отсутствие messages. CAPTCHA UI передавал prompt вместо content. Native history хранит ответ в content_list при content:''.

Пользователь запросил автоматическое прохождение. Старый solver был отключён, искал класс вместо реального id ручки и угадывал расстояние. Native путь его не вызывал и отменял capture при challenge. Blanket duplicate guard запрещал штатный Baxia replay. Stop отбрасывал error.qwenTurn и блокировал даже GET-восстановление отменённой задачи; native recovery угадывал legacy upload prompt.

## Изменения

- browser-proxy.mjs: viewport/styles/ancestor visibility; challenge только Qwen completion punish path и активный turn; dispose отменяет поздний callback. Native solver сохраняет исходную promise; при зависании сайта direct owned-worker GET восстанавливает exact finished ответ без повторного POST. Очередь обходится для предотвращения deadlock; signal polling прерывается.
- baxia-solver.mjs: auto включён, явный env0 отключает. Реальная ручка/геометрия, штатный retry после error, ограниченные попытки/время. Новая clearance и исчезновение challenge подтверждают успех; expired cookie отвергается. Stop распространяется, mouse.up в finally.
- native-composer.mjs: только один byte-identical replay после наблюдённого challenge и нового x5sec; прочие повторы запрещены. Ответ не дублируется, pending original aborts после replay.
- harvest.mjs: только finished answer parts, без thinking; прежний content сохраняет приоритет. Exact prompt/parent/done обязательны; provider.error запрещает recovery.
- client/account-session: typed auth history failure, один same-account refresh/GET/lease cleanup. Native full prompt не заменяется upload guess.
- ui-html.mjs: content для продолжения.
- code-agent/run.mjs: Stop сохраняет qwenTurn. harness runner/view: отменённый модельный checkpoint может прочитать историю; execution только recovered/not_sent proof. Executing tool/другие providers защищены.

## Проверки и текущий статус

Регрессии red→green. Focus29/29+5/5; agent/Harness focus218/218. Изолированный node --test --test-concurrency=2 --experimental-test-coverage --test-reporter=./scripts/coverage-reporter.mjs test/*.test.mjs:1559/1559,189 suites/16 coverage gates PASS. npm run check:ci, sync/build/mirrors/diff PASS. Неизолированный запуск дал sandbox EPERM; повтор с temporary HOME/runtime прошёл.

Две локальные попытки старой проверки не подтвердились. На новом исходном native запросе автоматическая проверка дала x5sec=true/challengeVisible=false. Native replay дал HTTP200 и сохранённый finished ответ, но promise сайта зависла; GET fallback исправляет возврат. Пользователь разрешил полный restart. Финальный Desktop запущен; тот же taskId принят200. GET восстановление и последующие ответы200 продолжили tools/план (tools2→17). Inspector закрывается после диагностики; CAPTCHA-сервисов/платежей нет.

Preview: output/qwen-captcha-visible-20261013/final-history-package; hash/verification.json. 280 runtime файлов совпадают с source. Прикладная задача записала файлы, остановилась на verify_task: Godot не разрешён в Allowed commands. Завершение/качество проекта не утверждаются. Авто попытки могут быть отвергнуты сервером.
