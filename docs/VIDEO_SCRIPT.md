# Сценарий видео: Memory + Skills в AI Free

> Актуально на: июнь 2026. Перед записью: `npm test` (190+), `npm start`.

---

## Быстрый чеклист перед записью

- [ ] Node ≥ 22 (SQLite FTS + graph) или ≥ 18 (JSON fallback — badge покажет `json`)
- [ ] Auth DeepSeek или Qwen уже есть (`npm start` без welcome-логина)
- [ ] Чат привязан к **реальному** проекту (не `$HOME`)
- [ ] Topbar: 🧠 Память **ON**, Skill auto **ON**
- [ ] Для «чистого» демо памяти: `rm -rf ~/.ai-free/memory` (опционально)
- [ ] Закрыть лишние окна, уведомления, режим «Не беспокоить»
- [ ] Разрешение: **1080×1920** (Short) или **1920×1080** с crop в Shorts
- [ ] Запись: OBS / QuickTime / Screen Studio

---

## Вариант A — Short 60 сек (основной)

### Hook (0–3 сек, голос + текст на экране)

> «Этот AI-кодер помнит, где ты уже ломался — и не чинит одно и то же дважды.»

### Таймкоды

| Сек | Экран | Действие | Голос |
|-----|-------|----------|-------|
| 0–5 | Терминал | `npm start` → окно чата | «Бесплатный AI-чат + код-агент — DeepSeek, Qwen…» |
| 5–12 | Topbar | Показать 🛠 Coder, 🧠 Память (active), Skill auto, dropdown | «Память и skills — прямо в UI, без CLI» |
| 12–18 | ⚙ Settings → **Агент** | Badge `Backend: sqlite · graph: sqlite`, список skills | «SQLite, Markdown vault, граф связей file↔bug↔fix» |
| 18–40 | Чат | `/code добавь комментарий в README про memory` | «Задача через /code…» |
| 40–50 | Ответ агента | Скролл к footer: `🧠 memory used · graph · saved · skill` | «Агент подтянул прошлый контекст и сохранил опыт» |
| 50–55 | Settings → Агент | Новая строка в Recent memory | «Всё локально в ~/.ai-free/memory» |
| 55–60 | Outro | GitHub + «npm start» | «Open source, бесплатно — ссылка в описании» |

### Безопасные demo-задачи (выбери одну)

1. `/code добавь в README секцию про Memory и Skills` — видно write + footer
2. `/skill code-review проверь src/memory/store.mjs` — виден skill в footer
3. Включить **Coder ON** → «найди опечатку в package.json description» — без префикса `/code`

---

## Вариант B — Long 3–5 мин (полное демо)

1. **Intro** (30 сек) — проблема: ChatGPT не помнит проект между сессиями
2. **Установка** (30 сек) — `git clone`, `npm install`, `npm start` (ускорить монтажом)
3. **Провайдеры** (20 сек) — переключение DeepSeek / Qwen в new chat
4. **Coder mode** (40 сек) — toggle 🛠, отличие от обычного чата
5. **Memory** (60 сек) — Settings → Агент, vault на диске, повторная задача → anti-repeat
6. **Skills** (40 сек) — dropdown `bug-fix`, `/skill video-script сделай hook для Short`
7. **Graph** (30 сек) — объяснить badge graph, показать связанные записи после 2-й задачи
8. **API** (20 сек) — Settings → API, `localhost:4317/v1`
9. **CTA** (20 сек) — star на GitHub, поддержка

---

## YouTube: готовые тексты

### Title (RU) — выбери один

1. AI Free: бесплатный код-агент с памятью (как Cursor, но free)
2. Память для AI-кодера — SQLite + Skills в одном окне
3. DeepSeek/Qwen + /code агент, который помнит твои баги

### Title (EN)

1. Free AI coding agent with memory — DeepSeek & Qwen
2. I built local agent memory (SQLite + graph) for free AI chats

### Description (RU)

```
AI Free — open-source CLI + desktop-окно для бесплатных AI-чатов (DeepSeek, Qwen, ChatGPT).

🆕 Memory + Skills:
• 🧠 Долговременная память — SQLite FTS5 + Markdown vault
• 🔗 Graph — связи task ↔ file ↔ bug ↔ fix
• ⚡ Skills — code-review, bug-fix, video-script + auto-match
• 🎛 Переключатели в topbar (память, skill) и Settings → Агент

Установка:
git clone https://github.com/Staks-sor/ai-free.git
cd ai-free && npm install && npm start

Документация: docs/AI_FREE_BRAINS_AND_SKILLS_PLAN.md
Сценарий этого ролика: docs/VIDEO_SCRIPT.md

#ai #coding #opensource #deepseek #qwen #cursor #agent #nodejs
```

### Tags

```
ai agent, free ai, deepseek, qwen, code assistant, memory, skills, open source, nodejs, programming, cursor alternative, local ai, sqlite
```

### Pinned comment

```
⭐ Если полезно — звезда на GitHub: https://github.com/Staks-sor/ai-free
📖 План архитектуры: docs/AI_FREE_BRAINS_AND_SKILLS_PLAN.md
🧠 Память хранится локально: ~/.ai-free/memory/
```

### Thumbnail (текст на обложке)

- **RU:** «Память + Skills» / «Free AI Coder»
- **EN:** «Agent Memory» / «Free & Local»

---

## Reels / TikTok / Telegram

- **Длина:** 30–45 сек (ещё короче, чем Short)
- **Hook:** только первые 2 сек — без intro-логотипа
- **Субтитры:** обязательно (многие смотрят без звука)
- **Хештеги в посте:** `#ai #coding #opensource #deepseek #программирование`

---

## B-roll (запасные кадры)

- Папка `~/.ai-free/memory/vault/*.md` в Finder/VS Code
- `npm test` — зелёный pass 190
- Settings → installed skills (3 builtin: code-review, bug-fix, video-script)
- Sidebar чатов с 📁 workspace

---

## Что обновлять при новых релизах

| Файл | Когда |
|------|-------|
| `docs/VIDEO_SCRIPT.md` | Новые фичи в UI, смена команд demo |
| `README.md` | Счётчик тестов, список skills |
| Description YouTube | Блок «🆕» в начале описания |
| Этот чеклист | Число тестов, новые toggles в topbar |

---

## Skill для генерации сценариев

В чате ai-free:

```
/skill video-script сделай 60-сек Short про memory и graph для YouTube
```

Или: Skill dropdown → `video-script` + задача в composer.
