# Единая карточка SYNVOX

Статус на 7 сентября 2026, после включения разрешения Chrome: оба пакета 0.4.26 загружены. JetBrains update 1163711 — Under review, площадка указала до двух рабочих дней. VS Marketplace принял пакет, статус Verifying 0.4.26; публичное название и краткое описание уже SYNVOX, на момент проверки иконка и README ещё от 0.4.25. Описание JetBrains сохранено через UI Always. Полное обновление публичных логотипов ещё не подтверждено.

## Название

SYNVOX — AI Chat & Coding Agent

Идентификаторы расширений сохраняются: `developers-daily-life.ai-free-vscode` и `ru.stas-sor.ai-free`. Это обновление существующих плагинов, не новые карточки.

## Краткое описание (одинаковое на обеих площадках)

SYNVOX (formerly AI Free) brings AI chat, coding agents and project memory into your development workflow.

## Полное описание

SYNVOX (formerly AI Free) brings AI chat, coding agents and project memory into your development workflow.

Connect supported AI providers, discuss your code and give an agent a concrete task in the current project. The agent can inspect files, propose or apply changes and run permitted project commands. Review generated changes and test results before accepting them.

Project chat history and memory are stored locally. Requests and relevant project context are sent to the selected AI provider; SYNVOX is not a fully offline AI model. Provider accounts, availability and usage limits apply separately.

SYNVOX is an alpha product under active development. Features, supported providers and the interface may change. The transition from AI Free to SYNVOX is in preparation; the announced SYNVOX plan is RUB 99 for 30 days with a 3-day trial. Paid access is not yet launched. Current release details, availability and terms are published on the official website.

Website: https://synvox.pro/
Terms and privacy: https://synvox.pro/documents/
Support: stas.sor@gmail.com

## Изображение

Использовать существующий серебристый знак SYNVOX из `website/static/images/synvox-mark-transparent.png` (256 × 256), без генерации другого символа. Для JetBrains подготовить соответствующий требованиям формат и проверить отображение в светлой и тёмной теме. Не заменять скриншоты интерфейса логотипом.

## Проверено в кабинетах 7 сентября 2026

- VS Marketplace: Update открывает загрузку VSIX. Отдельного редактора описания в этом меню нет.
- JetBrains: карточка 0.4.25. Первичная проверка ошибочно приняла отметку disabled в accessibility tree за фактическую блокировку: нажатие Edit Section открыло редактор. Описание изменено через UI без нового пакета.
- Для публикации полного ребрендинга подготовить отдельные пакеты на основе опубликованной 0.4.25, меняя только метаданные, README и иконки, с новой версией. Не включать незавершённые изменения из текущей рабочей папки.
- Проверить совпадение текста, логотипа и сохранение extension/plugin ID до загрузки. Публикация пакетов требует отдельного решения пользователя.
