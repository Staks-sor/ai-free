# Релизы SYNVOX

25 ноября 2026, Codex. Версия 0.5.65, бесплатное личное использование на условиях прежней лицензии.

## 0.5.65

`src/licensing/` и shared window runtime: startup/API/IDE не зависят от активации SYNVOX. В старом подмаршруте подписки локальный статус free_release, платёжные POST410. Сохранены локальное согласие на условия и отдельная авторизация провайдеров. UI без платёжных форм. Qwen HTTP429 без явного кода исчерпанной квоты больше не исключает аккаунт. Колокольчик объявлений в Desktop/VSCode/JetBrains.

`services/licensing/merchant-{run,http,bot}.mjs`: новые продажи остановлены, прежние подтверждения, сверка и поддержка сохранены. Production HTTPS: health paymentsEnabled=false; пять прежних маршрутов возвращают410. База сохранена. Сайт RU/EN предлагает бесплатный Desktop и пакеты IDE, старые условия и возвраты в архиве документов.

Сборки и `SHA256SUMS` опубликованы в [GitHub Release](https://github.com/Staks-sor/ai-free/releases/tag/v0.5.65), коммит `1dd5101`. Сайт `20261125-0565-free`: десять HTTPS-маршрутов вернули 200, SHA-256 трёх скачиваемых архивов совпали. Обновление Desktop со старых версий через ZIP. Ссылки и примечания в `../RELEASE-0.5.65.md`.

Локально 1754/1754 тестов, 193 набора, 16 порогов покрытия, проверка инвариантов, VS Code package и Gradle test/buildPlugin прошли. Desktop ZIP проверен на macOS с чистым и существующим хранилищем. Все архивы совпадают с 298 общими runtime-файлами, плагины содержат по шесть нативных сборок. Реальные ответы AI и запуск приложений на Windows/Linux в этом релизе не проверялись.

Marketplace ждут доступа к кабинетам издателя. VS Code `developers-daily-life.ai-free-vscode`, JetBrains `ru.stas-sor.ai-free` (33364). ID и версии проверены в архивах. CI исправлен: Ubuntu 24.04 для Playwright, независимый от X11 тест и актуальная проверка зеркала. На коммите `e67c553` [все четыре работы CI прошли](https://github.com/Staks-sor/ai-free/actions/runs/45499723932).

## 0.5.64

`output/release-0.5.64/`: Desktop ZIP, universal VSIX, JetBrains ZIP, SHA256SUMS, manifest и воспроизводимые audit/boot scripts. [Заметки](../RELEASE-0.5.64.md).

Форма сообщения о проблеме: локальная диагностика, предварительный просмотр, необязательные контакт/изображение и экспорт JSON. Онлайн-приём выключен до подготовки хранения в РФ/документов/личного Telegram-чата владельца. Пароли/ключи/история автоматически не включаются; текст/изображения могут содержать ПД. Qwen resource/readiness и DeepSeek CAPTCHA имеют безопасные технические события. Детали: `SUPPORT.md`.

Версии Desktop/VSCode/JetBrains и locks согласованы0.5.64. В итоговом JAR исправлено отсутствие Implementation-Version: manifest применяется ко всем Jar tasks, проверен фактический архив. История, аккаунты, ключ установки и публичный ключ проверки сохранены.

Red→green версии/архивный manifest; full1747/1747,193 suites/16 coverage gates; CI/VSCode build PASS. JDK21 Gradle test/buildPlugin6/6 PASS. Каждый архив совпадает с296 runtime-файлами; IDE содержат шесть native prebuilds, прежние IDs, без private data/services. Точный Desktop ZIP npm ci/npm start --no-window на macOS PASS; искусственные история/ID/ключ сохранены, report работает без активации, online disabled. Протокол: `desktop-boot-verification.json` рядом с ZIP.

Сайт `20261110-0564`: RU/EN страницы/инструкции/ссылки обновлены. Website23/23, check0/0, build/E2E16/16 PASS; UI1280/360 без overflow. HTTPS6 страниц, ZIP/version/SHA-256 PASS. Предыдущий `20261108-0563`,256 файлов и ZIP0.5.63 сохранены; robots/sitemap/updater неизменны. Desktop: https://synvox.pro/downloads/synvox-desktop-0.5.64.zip. Протокол: `output/release-0.5.64/site/public-verification.json`.
