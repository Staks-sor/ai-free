# SYNVOX 0.5.64

2026-11-10, Codex. `main/3db7d9c`, незакоммиченное дерево. Desktop опубликован на сайте; IDE-пакеты подготовлены для ручной загрузки владельцем в существующие записи Marketplace.

## Что изменилось

- Рядом с ошибкой и в Настройки → Статус появилась форма сообщения о проблеме: описание сбоя или пожелания, необязательный контакт и изображение.
- Версия и сборка программы, ОС, среда и технические коды подставляются автоматически. Отчёт можно просмотреть целиком и сохранить файлом. Техническая часть не включает чаты, проекты, пути, лицензионный ключ или авторизацию провайдеров.
- Онлайн-приём отчётов **выключен**: автоматической отправки нет. Серверная часть ожидает подтверждённого хранения в РФ, проверки документов и конфигурации личного Telegram-чата владельца. Текст и изображение могут содержать ПД; анонимность не обещается.
- Добавлена безопасная диагностика загрузки ресурсов/готовности Qwen и исходов CAPTCHA DeepSeek. Обход CAPTCHA и исправление всех внешних ограничений не заявляются.
- В конечном JAR JetBrains сохранена Implementation-Version для диагностики версии плагина. IDs Marketplace и ключ проверки подписки сохранены.

## Файлы

`output/release-0.5.64/`:

- `synvox-desktop-0.5.64.zip` — общий архив macOS/Windows/Linux. Публично: https://synvox.pro/downloads/synvox-desktop-0.5.64.zip.
- `synvox-vscode-0.5.64.vsix` — универсальный пакет, Visual Studio Marketplace: `developers-daily-life.ai-free-vscode`.
- `synvox-jetbrains-0.5.64.zip` — JetBrains Marketplace → Upload Update, `ru.stas-sor.ai-free`.
- SHA256SUMS, manifest.json, verify-packages.py, verify-desktop-boot.mjs и протокол запуска.

Desktop обновляется вручную: остановить программу, распаковать ZIP отдельно, выполнить `npm ci`, затем `npm start`. В выводе должно быть `ai-free@0.5.64`. Сохранить старую папку и пользовательские `.deepseek-cli`, `.qwen-cli`, `.ai-free`. INSTALL-RU/EN внутри; Node22+/Python3.10+ остаются требованиями.

## Проверки

- Версии red→green. Full1747/1747,193 suites/16 coverage gates; CI/VSCode build PASS. JDK21 Gradle test/buildPlugin6/6 PASS.
- Каждый архив содержит296 совпадающих runtime-файлов; IDE включают шесть native prebuilds. Проверены версии/IDs/прежний public license key, отсутствие private data/services. Воспроизводимый аудит проверяет фактический manifest конечного JAR.
- Точный Desktop ZIP: npm ci, native module и npm start --no-window PASS на macOS. Искусственные история/ID/ключ сохранены; локальный report доступен при недоступной активации, online disabled. Реальные профили не использовались.
- Website23/23, check0/0, build/E2E16/16 PASS. UI1280/360: визуально/computed styles без overflow. HTTPS6 страниц, ZIP/version/SHA-256 PASS. Desktop SHA-256: `43559d6e04d00c5117dbae69635183bb0ed4594f01301d5464dc1f879b0ac115`.
- Сайт `20261110-0564`; прежний `20261108-0563` и256 файлов сохранены. robots/sitemap/updater/ZIP0.5.63 неизменны по HTTPS-хешам. API/БД/службы не менялись. Протокол: `output/release-0.5.64/site/public-verification.json`.

Физические Windows/Linux, GUI точных IDE-пакетов и живой provider turn0.5.64 не проверялись. Marketplace публикует владелец. Signed updater/EXE/DMG не выпускались. Предыдущие пакеты сохранены.
