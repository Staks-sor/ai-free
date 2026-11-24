# SYNVOX 0.5.63

Подготовлено 2026-11-07, Codex. `main/3db7d9c`, незакоммиченное дерево. Пакеты для ручного обновления существующих записей Marketplace:

- `output/release-0.5.63/synvox-vscode-0.5.63.vsix` — Visual Studio Marketplace, `developers-daily-life.ai-free-vscode`, общий Windows/macOS/Linux.
- `output/release-0.5.63/synvox-jetbrains-0.5.63.zip` — JetBrains Marketplace → Upload Update, `ru.stas-sor.ai-free`.
- `output/release-0.5.63/synvox-desktop-0.5.63.zip` — ручная установка Desktop: распаковать отдельно, npm ci, npm start. INSTALL-RU/EN внутри; Node22+/Python3.10+.
- `SHA256SUMS`, `manifest.json`, `verify-packages.py` рядом с архивами. Desktop проверяется также `verify-desktop.py`.

## Исправления

Скриншот с Qwen «login successful» и неопределённым зависанием позволил проверить отдельный воспроизводимый дефект: завершение входа ждало неограниченный storageState export/close. Причина именно клиентского случая неизвестна: ОС, версия и этап зависания не предоставлены.

`browser/camoufox-runtime.mjs`: экспорт состояния ограничен5с; при ошибке сохраняется прежний файл. Новый снимок записывается атомарно с правами0600 через общий state-writer. Поздний ответ экспорта не перезаписывает снимок. Совместные close используют один финальный save/close. Graceful context close получает5с, затем закрывается только принадлежащий сессии Browser (включая persistent context); fallback ограничен35с. Зависание всех способов закрытия выдаёт CAMOUFOX_CLOSE_TIMEOUT с инструкцией перезапуска, повтор close разрешён. Максимум ожидания cleanup при полностью зависшем browser transport — около45с; синхронный файловый I/O этим таймером не ограничивается. Поиск/убийство посторонних браузерных процессов не добавлялись.

Qwen login показывает phase closing и пишет «login successful» после закрытия. Ошибка cleanup больше не скрывается; захваченная auth не удаляется. Qwen manager сохраняет progress до завершения job и игнорирует поздние события. DeepSeek тоже показывает closing.

Включён предыдущий диагностический патч: отсутствующий/нечитаемый pass hCaptcha отображается как unknown, не false; безопасные error-codes сохраняются. Состояние проверки видно в настройках. Успешная CAPTCHA не заменяет подтверждение авторизованной сессии. Автоматическое решение CAPTCHA не добавлялось.

## Проверки

- Зависания export/context close, параллельный close, поздний snapshot reply и полностью зависший browser:5 regression red→green. Qwen finishing/log order/cleanup error/progress callbacks:3 red→green. Периодические checkpoints проверяются настоящими временными файлами вместо прежнего regex.
- `npm run test:coverage`:1730/1730,193 suites,16 gates PASS. `npm run check:ci`, VS Code build/diff PASS. JDK21 `./gradlew test buildPlugin --no-daemon`:6/6 JUnit PASS.
- Настоящий Camoufox с изолированными тестовыми профилями: localStorage/постоянная cookie пережили restart в portable/persistent режимах; файлы0600. Искусственное зависание context.close устранено за5197ms; storageState — за5145ms с сохранением прежнего snapshot. В обоих случаях собственный Browser отключён. Протокол: `output/acceptance/camoufox-close-2026-11-07.mjs`.
- UI closing Qwen/DeepSeek1280/360: computed styles, видимый status, disabled reconnect, отсутствие overflow. Screenshots/script: `output/playwright/release-0.5.63/`.
- Архивы:290 runtime-файлов совпадают с исходниками, шесть platform prebuilds, VSIX universal; marketplace IDs/public license key сохранены, приватных auth/keys нет.

Точный VSIX установлен на macOS; UI0.5.63 и реальный read-only Qwen coder ответили по-русски без повторного входа. Файлы тестового проекта не изменились; история/подписка и хеш ID/ключа установки сохранены. Холодная задача с чтением файла и двумя model turns заняла107с; скорость первого запроса остаётся ограничением, ускорение этим патчем не подтверждено.

## Ограничения

Клиентская CAPTCHA/загрузка со скриншота не воспроизведена на его компьютере; обновлённая диагностика не доказывает конкретную причину. Физические Windows/Linux, remote SSH/WSL и JetBrains GUI не проверялись. Python3.10+/Node22+ и доступность сервисов провайдера остаются требованиями. Marketplace публикует владелец; Desktop0.5.63 опубликован на сайте8 ноября, production API/DB не менялись. Архивы0.5.62 сохранены.


## Уточнение Desktop-клиента

7 ноября получены ОС/запуск и изучено90-секундное видео: Windows11Pro26H2 (сообщение пользователя), Desktop0.5.60 в терминале и заголовке. В начале уже виден Qwen page.waitForFunction timeout45000ms. Затем открывается DeepSeek sign_in, пользователь проходит ручной challenge, виджет показывает «Попробуйте ещё раз»; подтверждённого входа нет. Оценка правильности ответов на CAPTCHA не выполнялась. Этот фрагмент не подтверждает прежнюю гипотезу зависания cleanup; точная причина отказа challenge остаётся неизвестной.

Предыдущие0.5.61–0.5.63 поставлялись здесь как IDE-плагины и этот Desktop не обновляли. Теперь подготовлен отдельный Desktop0.5.63:290 runtime-файлов совпадают с исходниками/IDE-пакетами, приватных данных нет, package/lock/start/Node22/public license key проверены. Из точного ZIP в отдельной папке выполнен npm ci; npm start --no-window на macOS загрузил UI0.5.63 и сохранил искусственно подготовленные историю/ID/ключ в изолированном хранилище. Нативный модуль загрузился. Протокол: `output/acceptance/desktop-zip-2026-11-07.mjs`. Графический Desktop и фактическая CAPTCHA Windows этой проверкой не подтверждаются. 8 ноября Desktop опубликован: https://synvox.pro/downloads/synvox-desktop-0.5.63.zip. RU/EN главная, инструкции и обновления переведены на0.5.63, добавлены требования Python3.10+ и проверка версии в npm start. Сайт:23/23 теста, Svelte check0/0, build и E2E16/16 PASS. После атомарной публикации проверены6 HTTPS-страниц, версия внутри скачанного ZIP и SHA-256 `508422ed10b988d4afb4eb4fdaa77e4898888f23fc3438e4f7668a2bc34b8b8b`. Прежние236 файлов сохранены; robots/sitemap/desktop updater/ZIP0.5.60 совпадают по HTTPS. Протокол: `output/release-0.5.63/site-20261108/public-verification.json`.
