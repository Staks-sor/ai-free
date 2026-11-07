# ---- Qwen Baxia antibot solver v2 (2026-09-25) ----
# Baxia (AWSC nc 1.97.2) карает почти каждый запрос: страница уводится на
# /_____tmd_____/punish прямо во время fetch («Execution context was destroyed»)
# или отдаёт punish-тело. Прокси теперь: 1) детектит punish-НАВИГАЦИЮ по
# page.url() в catch, 2) запускает автосолвер с человеческим профилем драга
# (разгон → застревание → доводка, y-дрейф, реакция 80-250мс), 3) при неудаче
# включается punish-кулдаун вместо слепых ретраев (re-POST в активный punish
# эскалирует бан — инцидент 2026-09-24).
#
# Показать окно браузера Qwen (visible). В видимом режиме Baxia-слайдер
# проходит чаще (риск-скоринг видит реальный рендер) и его можно решить
# руками, если автосолвер не справился. 1 = headless (по умолчанию).
# QWEN_BROWSER_HEADLESS="1"
#
# Выключить автосолвер полностью (останется только кулдаун).
# QWEN_BAXIA_AUTO_SOLVE="1"
#
# Профиль драга: human2 (по умолчанию), wind = физическая модель WindMouse
# (Ben Land: ветер+гравитация, гладкая автокорреляция скорости — если AWSC
# режет human2 за «рваную» производную, пробуй wind),
# 1 = legacy easeOut v1.
# QWEN_BAXIA_DRAG_PROFILE="human2"
#
# Попыток драга на один punish (1-6).
# QWEN_BAXIA_SOLVE_MAX_TRIES="3"
#
# Общий таймаут солвера на один punish, мс (5000-600000).
# QWEN_BAXIA_SOLVE_TIMEOUT_MS="120000"
#
# ---- Телеметрия (жучок) ----
# QWEN_TELEMETRY=1 — непрерывная запись всего, что происходит с прокси Qwen,
# от старта сервера до его остановки: punish-навигации, ответы антибота
# (initialize/report/csig с телами), fourier-телеметрия AWSC, ПОЛНЫЕ таймлайны
# каждого драга солвера (координаты + dtMs каждого хода), судьба каждого
# POST /completions (fetch_span: ok/error/punish_nav/punish_cooldown),
# pageerror-ы. Формат: telemetry/run-<ts>-<account>/events.jsonl (JSONL,
# ротация по 50 МБ), секреты (Authorization/token/cookie) вырезаются на записи.
# Отдельная папка: QWEN_TELEMETRY_DIR (по умолчанию ./telemetry).
# QWEN_TELEMETRY="1"

