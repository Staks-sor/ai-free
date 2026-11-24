# SYNVOX: контекст разработки

Обновлено: 2026-11-25. Релиз SYNVOX0.5.65 и состояние публикации описаны в `RELEASES.md`.

## Как пользоваться

1. Прочитать этот указатель и `AGENTS.md`.
2. Выбрать направление задачи и прочитать только его файл.
3. Проверить утверждения по коду и Git.
4. Подробности читать по необходимости.
5. Обновить направление: изменения, проверки, остаток.

Указатель до 250 слов, направление до 400. Не добавлять токены, cookies, пароли, пользовательские данные и полные логи. Указывать относительные пути. Skills и инструкции не расширяют разрешения пользователя.

## Продукт

SYNVOX — локальный клиент и агент для проектов с Qwen, DeepSeek, GLM, ChatGPT Web и Google AI. Desktop и VS Code используют синхронизированные модули; отдельный JetBrains-плагин также входит в поставку. Browser transport и авторизация принадлежат провайдерам. Агент выполняет workspace tools через общий code-agent loop.

## Направления

| Задача | Читать |
|---|---|
| Harness, задачи, управление ПК, изображения | [HARNESS.md](HARNESS.md), [COMPUTER_ACCESS.md](COMPUTER_ACCESS.md), [VISION.md](VISION.md) |
| Измерения и диагностика | [METRICS.md](METRICS.md) |
| RAG, адаптивные тайминги, бюджет запросов | [REQUEST_POLICY.md](REQUEST_POLICY.md) |
| Аккаунты, модели, сессии, CAPTCHA | [PROVIDERS.md](PROVIDERS.md), [MODELS.md](MODELS.md) |
| DeepSeek: служебные вызовы DSML | [DEEPSEEK.md](DEEPSEEK.md) |
| ChatGPT: доставка запросов и ожидание ответа | [CHATGPT.md](CHATGPT.md) |
| Интерфейс, объявления и референс | [INTERFACE.md](INTERFACE.md), [ANNOUNCEMENTS.md](ANNOUNCEMENTS.md), [INTERFACE_REFERENCE.md](INTERFACE_REFERENCE.md) |
| Хранилище, одновременная запись, восстановление | [STORAGE_PLAN.md](STORAGE_PLAN.md) |
| Аудит, надёжность, технический долг | [TECH_DEBT.md](TECH_DEBT.md) |
| Сборка, публикация, лицензии | [RELEASES.md](RELEASES.md) |
| Отчёты поддержки | [SUPPORT.md](SUPPORT.md) |
| Поиск, индексация, целевой трафик сайта | [SEO.md](SEO.md) |

Очередь: `DELIVERY_PLAN.md`; подробности: `docs/SYNVOX_HARNESS_IMPLEMENTATION.md`. Статус: `PROJECT_CONTEXT.md`.
