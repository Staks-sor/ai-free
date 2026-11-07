/**
 * Локальный солвер Baxia punish-слайдера (AWSC nc, «проведите вправо»).
 *
 * Как это работает на chat.qwen.ai (наблюдения из HAR-дампа 2026-08-20):
 * - Baxia перехватывает POST /api/v2/chat/completions и вместо SSE отдаёт
 *   punish-страницу /_____tmd_____/punish?x5step=2&action=captcha.
 * - Qwen SPA рисует модалку (#baxia-dialog-content) с same-origin iframe
 *   Alibaba AWSC noCaptcha слайдера (nc_1_n1z — ручка, nc_1__scale_text —
 *   трек с текстом «Проведите вправо», сцена register, lang ru_RU).
 * - Это НЕ слайдер-пазл с картинкой: достаточно довести ручку до правого
 *   края трека человеческим драгом. Внешний сервис (2Captcha/CapMonster)
 *   не нужен.
 * - После успешного солва Baxia ставит cookie x5sec (report
 *   type=setCookieSuccess) и сам реплеит исходный fetch с тем же
 *   X-Request-Id — вручную повторять запрос не надо.
 *
 * Фоллбэк: если солвер не увидел слайдер или не добился x5sec за
 * QWEN_BAXIA_SOLVE_TIMEOUT_MS — остаёмся на punish-кулдауне из
 * request-pacing (дефолт 10 мин, потолок QWEN_PUNISH_COOLDOWN_MAX_MS).
 */

export const BAXIA_SOLVER_VERSION = "baxia-nc-drag-v2";

/**
 * URL punish-страницы Baxia? Детект нужен в двух местах: response-текст
 * (стандартный путь) и page.url() ПОСЛЕ «Execution context was destroyed» —
 * Baxia (baxiaFetchHandler.js) сам навигирует страницу на
 * /_____tmd_____/punish?x5step=2&action=captcha, и fetch падает с ошибкой
 * navigation ещё до получения тела. См. HAR 2026-09-24 (12 циклов punish).
 */
export function isBaxiaPunishUrl(url) {
  if (typeof url !== "string" || url.length === 0) return false;
  return /\/_____tmd_____\/(?:punish|punishTextFetch)/.test(url);
}

/**
 * Ошибка — следствие НАВИГАЦИИ страницы (не таймаут/сеть)? Именно такие
 * ошибки бросает page.evaluate, когда Baxia уводит страницу на punish
 * прямо во время fetch: «Execution context was destroyed, most likely
 * because of a navigation». Используется вместе с isBaxiaPunishUrl(page.url()).
 */
export function isBaxiaNavigationError(error) {
  const message = String(error?.message || error || "");
  return /Execution context was destroyed|most likely because of a navigation|net::ERR_ABORTED/i.test(message);
}

/**
 * URL, которые Baxia карает punish-навигацией. ВАЖНО: это не только
 * /chat/completions — лог 2026-09-25 показал, что create_chat
 * (/api/v2/chats/new) рвётся так же («Execution context was destroyed»
 * на create_chat_start). Гейтить punish-детект только по completions
 * означало молчание солвера на первом же запросе цикла.
 */
export function isBaxiaGuardedUrl(url) {
  if (typeof url !== "string" || url.length === 0) return false;
  return /\/api\/v2\/(?:chat\/completions|chats\/new)(?:$|\?|\/)/.test(url);
}

/** Время между точками пути драга: человек не двигает мышь равномерно. */
const HUMAN_STEP_MS = [8, 12, 16, 20, 24, 30];

/**
 * Человекоподобный путь драга. Возвращает массив точек
 * { x, y, dtMs } длиной steps+1: от (start,y=0) до (end,0).
 * x монотонно растёт с лёгким джиттером, у конца — overshoot и
 * возврат (типичная траектория «промахнулся и подтянул»).
 * rng инъекцируется для детерминизма в тестах.
 */
export function buildDragPath({ start, end, steps, jitter = 2, rng = Math.random, overshootPx = 0 }) {
  const s = Number(start) || 0;
  const e = Number(end) || 0;
  const n = Math.max(2, Math.min(60, Math.floor(Number(steps) || 20)));
  const distance = e - s;
  const path = [];
  // easeOutQuad: быстрый разгон, замедление к концу — так тащат слайдеры люди.
  const ease = (t) => t * (2 - t);
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    let x = s + distance * ease(t);
    if (jitter > 0 && i > 0 && i < n) {
      // Джиттер не должен разворачивать движение: масштабируем его
      // текущим шагом (к концу ease-out шаг мал — джиттер гаснет).
      const step = Math.abs(x - path[path.length - 1].x);
      const j = Math.min(jitter, Math.max(0.3, step * 0.4));
      x += (rng() * 2 - 1) * j;
    }
    path.push({
      x: Math.round(x * 10) / 10,
      y: i === 0 || i === n ? 0 : Math.round((rng() * 2 - 1) * jitter * 10) / 10,
      dtMs: i === 0 ? 0 : HUMAN_STEP_MS[Math.floor(rng() * HUMAN_STEP_MS.length)],
    });
  }
  if (overshootPx > 0 && n >= 8) {
    // Зайти за цель и плавно вернуть: 2 точки за end, финал точно в end.
    const back1 = e + overshootPx * (0.5 + rng() * 0.5);
    const back2 = e + overshootPx * 0.2;
    path[n - 2] = { x: Math.round(back1 * 10) / 10, y: path[n - 2].y, dtMs: path[n - 2].dtMs };
    path[n - 1] = { x: Math.round(back2 * 10) / 10, y: path[n - 1].y, dtMs: path[n - 1].dtMs };
    path[n] = { x: e, y: 0, dtMs: HUMAN_STEP_MS[Math.floor(rng() * HUMAN_STEP_MS.length)] };
  }
  path[n] = { x: e, y: 0, dtMs: path[n].dtMs };
  return path;
}

/** Есть ли уже валидный (непустой) x5sec — признак недавнего успешного солва. */
export function hasX5SecCookie(cookies) {
  if (!Array.isArray(cookies)) return false;
  const hit = cookies.find((c) => c && c.name === "x5sec" && typeof c.value === "string" && c.value.length > 0);
  return Boolean(hit);
}

/**
 * Конфиг солвера. QWEN_BAXIA_AUTO_SOLVE=0 выключает полностью
 * (остаётся только кулдаун-фоллбэк).
 */
export function resolveBaxiaSolverConfig(env = process.env) {
  const num = (name, fallback) => {
    const raw = env[name];
    if (raw === undefined || raw === null || raw === "") return fallback;
    const v = Number(raw);
    return Number.isFinite(v) ? v : fallback;
  };
  const enabledRaw = env.QWEN_BAXIA_AUTO_SOLVE;
  const enabled = enabledRaw === undefined || enabledRaw === "" ? true : !/^(0|false|no|off)$/i.test(String(enabledRaw));
  return {
    enabled,
    maxTries: Math.max(1, Math.min(6, num("QWEN_BAXIA_SOLVE_MAX_TRIES", 3))),
    settleMs: Math.max(200, Math.min(5_000, num("QWEN_BAXIA_SOLVE_SETTLE_MS", 800))),
    totalTimeoutMs: Math.max(5_000, Math.min(600_000, num("QWEN_BAXIA_SOLVE_TIMEOUT_MS", 120_000))),
    dragProfile: /^(0|1|2|human1|human2|wind)$/i.test(String(env.QWEN_BAXIA_DRAG_PROFILE ?? "")) ? String(env.QWEN_BAXIA_DRAG_PROFILE).toLowerCase() : "human2",
  };
}

/**
 * ЧЕЛОВЕКОПОДОБНЫЙ ТАЙМЛАЙН ДРАГА v2 (профиль human2, HAR 2026-09-24).
 *
 * Чем отличался старый v1 (easeOut + мелкий джиттер, 20-35 ходов, 8-30 мс
 * на ход) от реального человека, судя по телеметрии fourier.taobao.com
 * (AWSC nc 1.97.2 карает слишком «чистые» траектории):
 *  - нет фазы наведения (курсор появляется на ручке мгновенно);
 *  - первая задержка после mousedown = 0 мс (у человека 80-250 мс реакции);
 *  - скорость монотонно гаснет (easeOut) — люди тормозят РЫВКАМИ: разгон,
 *    плато-застревание, короткий рывок к краю, микропауза, доводка;
 *  - нет y-дрейфа (вертикальный джиттер ≤2px симметричен — люди уползают
 *    вниз на 1-4px и не возвращаются);
 *  - нет ховера-паузы перед отпусканием.
 *
 * Структура moves: { type: approach|down|drag|pause|up, x, y, dtMs },
 * где x/y — абсолютные координаты страницы, dtMs — пауза ПЕРЕД ходом.
 * rng инъекцируется для детерминизма в тестах.
 */
export function buildHumanDragTimeline({ start, end, rng = Math.random, trackHeightPad = 5 }) {
  const s = Number(start) || 0;
  const e = Number(end) || 0;
  const distance = Math.max(1, e - s);
  const moves = [];

  // 1) Наведение: курсор приходит НЕ в центр ручки — со случайным смещением
  //    в 1-6px (два-три approach-хода, как физическое движение к слайдеру).
  const approachOffset = (rng() * 2 - 1) * 6;
  const approachSteps = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < approachSteps; i += 1) {
    const t = (i + 1) / approachSteps;
    moves.push({
      type: "approach",
      x: Math.round((s + approachOffset * (1 - t)) * 10) / 10,
      y: Math.round((rng() * 2 - 1) * 4 * 10) / 10,
      dtMs: i === 0 ? 0 : 40 + rng() * 90,
    });
  }
  // Финальный approach — точно на ручку + микропауза «прицеливания».
  moves.push({ type: "approach", x: s, y: 0, dtMs: 60 + rng() * 120 });

  // 2) mousedown + задержка реакции человека (80-250 мс) ДО первого сдвига.
  moves.push({ type: "down", x: s, y: 0, dtMs: 80 + rng() * 170 });

  // 3) Драг тремя фазами скорости (рывковый профиль):
  //    A. разгон — 35% пути, быстро;
  //    B. застревание — 20-45% пути, медленно, с микроостановками;
  //    C. доводка — остаток, средний темп + финальный толчок к краю.
  const stallStart = 0.35 + rng() * 0.1; // 0.35..0.45
  const stallEnd = stallStart + 0.2 + rng() * 0.25; // +0.2..0.45
  const yDriftTarget = (rng() * 2 - 1) * trackHeightPad * 0.8; // уползание по y
  const n = 26 + Math.floor(rng() * 14); // 26..39 drag-точек
  let lastY = 0;
  let stalledOnce = false;
  for (let i = 1; i <= n; i += 1) {
    const linear = i / n;
    // Кусочно-линейная скорость: быстрый разгон, тягучий stall, ровная доводка.
    let progress;
    if (linear < stallStart) {
      progress = (linear / stallStart) * (stallStart + 0.18);
    } else if (linear < stallEnd) {
      const t = (linear - stallStart) / Math.max(0.05, stallEnd - stallStart);
      progress = stallStart + 0.18 + t * 0.06; // почти стоит (прошли лишь +6%)
    } else {
      const t = (linear - stallEnd) / Math.max(0.05, 1 - stallEnd);
      const base = stallStart + 0.24;
      progress = base + t * (1 - base);
    }
    // y-дрейф: медленное уползание к yDriftTarget, без возврата.
    lastY = yDriftTarget * linear + (rng() * 2 - 1) * 0.8;
    let dtMs;
    if (i === 1) dtMs = 40 + rng() * 60; // стартовое усилие руки после реакции
    else if (linear < stallStart) dtMs = 14 + rng() * 16; // разгон 14-30 мс
    else if (linear < stallEnd) dtMs = 26 + rng() * 34; // застревание 26-60 мс
    else dtMs = 16 + rng() * 22; // доводка 16-38 мс
    moves.push({
      type: "drag",
      x: Math.round((s + distance * Math.min(progress, 1)) * 10) / 10,
      y: Math.round(lastY * 10) / 10,
      dtMs: Math.round(dtMs),
    });
    // Микропауза внутри stall (1 раз): человек «передумывает» на долю секунды.
    if (!stalledOnce && linear > stallStart + 0.05 && linear < stallEnd && rng() < 0.45) {
      moves.push({ type: "pause", x: moves[moves.length - 1].x, y: moves[moves.length - 1].y, dtMs: 120 + rng() * 240 });
      stalledOnce = true;
    }
  }

  // 4) Доводка: последний ход точно на правый край трека (или на 1-2px раньше —
  //    люди недоводят; сервер обычно принимает). Ставим точно в e.
  moves.push({ type: "drag", x: e, y: Math.round(yDriftTarget * 10) / 10, dtMs: 20 + rng() * 30 });

  // 5) Ховер-пауза перед отпусканием (человек убеждается, что доехал).
  moves.push({ type: "pause", x: e, y: Math.round(yDriftTarget * 10) / 10, dtMs: 90 + rng() * 200 });

  // 6) mouseup.
  moves.push({ type: "up", x: e, y: Math.round(yDriftTarget * 10) / 10, dtMs: 0 });

  return { version: BAXIA_SOLVER_VERSION, profile: "human2", moves };
}

/**
 * WINDMOUSE-ДРАГ (профиль wind, порт алгоритма Ben Land, 2009).
 *
 * Зачем: AWSC-слайдер (fourier.taobao.com) скорит автокорреляцию скорости
 * траектории. human2 — кусочно-линейный профиль с пошаговым джиттером:
 * производная скорости там «рваная». WindMouse — физическая модель: на
 * курсор действуют случайный «ветер» (momentum, обновляется редко) и
 * «гравитация» к цели (растёт у финиша). Скорость меняется ГЛАДКО,
 * вторые производные близки к человеческим — этим он и ценен.
 *
 * Оригинал: MIT, https://github.com/AsfhtgkDavid/windmouse (Python).
 * Здесь: чистый JS, детерминизм через инъекцию rng, обвязка под таймлайн
 * солвера (approach/down/drag/pause/up), y-подвязка к цели и ограничение
 * числа шагов (страховка от бесконечного ветра).
 */
export function buildWindMouseDragTimeline({
  start,
  end,
  rng = Math.random,
  gravity = 25,      // сила притяжения к цели (растёт при подходе)
  windMag = 6,       // максимальная сила «ветра» (инерция импульса)
  maxPoints = 120,   // страховка от бесконечного цикла
  yDrift = 3,        // целевой вертикальный дрейф (px от центра трека)
} = {}) {
  const s = Number(start) || 0;
  const e = Number(end) || 0;
  const moves = [];

  // Approach: пара ходов наведения со случайного смещения.
  const approachOffset = (rng() * 2 - 1) * 5;
  moves.push({ type: "approach", x: Math.round((s + approachOffset) * 10) / 10, y: Math.round((rng() * 2 - 1) * 3 * 10) / 10, dtMs: 0 });
  moves.push({ type: "approach", x: s, y: 0, dtMs: 50 + rng() * 100 });

  // mousedown + человеческая реакция.
  moves.push({ type: "down", x: s, y: 0, dtMs: 90 + rng() * 160 });

  // --- ядро WindMouse (Ben Land): v=(v+W+G·unit)/3, W инерционен, dist —
  // гипотенуза до (e, yTarget): проскок за цель сам тянет курсор назад. ---
  let x = s;
  let y = 0;
  let vX = 0;
  let vY = 0;
  let wX = 0;
  let wY = 0;
  let guard = 0;
  const yTarget = (rng() * 2 - 1) * yDrift;
  const total = Math.max(1, e - s);

  while (guard < maxPoints) {
    guard += 1;
    const dx = e - x;
    const dy = yTarget - y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) break; // доехали

    // Ветер с инерцией: W = (W*3 + rand*5)/8 — обновляется каждый шаг,
    // но 3/8 веса несёт предыдущий импульс (гладкая корреляция скорости).
    wX = (wX * 3 + (rng() * 2 - 1) * windMag * 5) / 8;
    wY = (wY * 3 + (rng() * 2 - 1) * windMag * 1.75) / 8;

    // Гравитация ~G по единичному вектору к цели + ветер; v делится на 3
    // (сильное затухание — исключает разгон и проскоки).
    vX = (vX + wX + gravity * dx / dist) / 3;
    vY = (vY + wY + gravity * dy / dist) / 3;

    // Кламп максимальной скорости (в духе M_0 оригинала).
    const v = Math.hypot(vX, vY);
    if (v > 6) {
      vX = (vX / v) * 6;
      vY = (vY / v) * 6;
    }

    const stepX = Math.round(vX * 10) / 10;
    const stepY = Math.round(vY * 10) / 10;
    if (stepX === 0 && stepY === 0 && dist > 1.5) {
      vX += 0.6 + rng() * 0.8; // редкий толчок при застревании
      continue;
    }
    x = Math.round((x + stepX) * 10) / 10;
    y = Math.round((y + stepY) * 10) / 10;
    if (x < s - 2) x = s - 2; // не откатываемся к старту трека

    // Задержка: тяжёлый хвост распределения (рано — быстро, ближе — чаще паузы).
    const progress = Math.min(1, Math.max(0, (x - s) / total));
    const dtMs = Math.round(8 + Math.pow(rng(), 2) * (10 + 26 * progress));
    moves.push({ type: "drag", x, y, dtMs });
  }

  // Доводка: точный ход на e + микропауза + mouseup.
  moves.push({ type: "drag", x: e, y: Math.round(yTarget * 10) / 10, dtMs: 25 + rng() * 40 });
  moves.push({ type: "pause", x: e, y: Math.round(yTarget * 10) / 10, dtMs: 100 + rng() * 180 });
  moves.push({ type: "up", x: e, y: Math.round(yTarget * 10) / 10, dtMs: 0 });

  return { version: BAXIA_SOLVER_VERSION, profile: "wind", moves };
}

/**
 * Ждать появления iframe-слайдера в модалке Baxia на странице чата.
 * Возвращает ElementHandle | null.
 */
export async function waitForBaxiaSlider(page, { timeoutMs = 15_000, pollMs = 400, log } = {}) {
  const deadline = Date.now() + Math.max(1_000, timeoutMs);
  while (Date.now() < deadline) {
    try {
      const handle = await findBaxiaSlider(page);
      if (handle) return handle;
    } catch (err) {
      if (log) log(`slider probe failed: ${err?.message || err}`);
    }
    await page.waitForTimeout(pollMs);
  }
  return null;
}

/**
 * Геометрия драга из boundingBox найденного элемента. Телеметрия 2026-09-25
 * (run-08-44-44): startX=640 = центр вьюпорта, deltaX=0 на всех трайах —
 * фоллбэк-селектор div#nc_1__scale_text это ТРЕК, а не ручка; mousedown по
 * треку nc-виджет игнорирует. Если нашли трек — тянем от левого края
 * (ручка ~квадрат, размер ≈ высоте трека) до правого.
 */
export function computeSliderDragGeometry(box, selector = "handle") {
  if (!box || typeof box.x !== "number") return null;
  const isTrack = /scale_text/.test(String(selector));
  if (isTrack) {
    const r = Math.max(10, box.height / 2);
    return { startX: box.x + r, endX: box.x + box.width - r, fromTrack: true };
  }
  return { startX: box.x + box.width / 2, endX: box.x + box.width / 2 + 300, fromTrack: false };
}

/**
 * Найти ручку слайдера. Слайдер AWSC nc живёт в same-origin iframe
 * (baxia-dialog / nc-container). Same-origin => доступ к содержимому
 * фрейма разрешён. Пытаемся несколько селекторов и main-frame fallback.
 * Возвращает { el, selector, frameUrl } | null — selector нужен, чтобы
 * отличить ручку от трека (см. computeSliderDragGeometry).
 */
export async function findBaxiaSlider(page) {
  const selectors = [
    "span.nc_1_n1z", // ручка nc-слайдера
    "div.nc-lang-cnt span[role=button]", // fallback: ручка как role=button
    "div#nc_1__scale_text", // сам трек (ручки нет — геометрия по краям)
  ];
  for (const frame of page.frames()) {
    for (const sel of selectors) {
      try {
        const el = await frame.$(sel);
        if (el) {
          const visible = await el.evaluate((node) => {
            const r = node.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          if (visible) {
            let frameUrl = "";
            try { frameUrl = frame.url(); } catch {}
            return { el, selector: sel, frameUrl };
          }
        }
      } catch {
        // cross-origin frame или фрейм умер — пропускаем
      }
    }
  }
  return null;
}

/**
 * Решить слайдер человеческим драгом: исполнить таймлайн из
 * buildHumanDragTimeline (профиль human2) или старый buildDragPath
 * (QWEN_BAXIA_DRAG_PROFILE=1). Возвращает true, если драг дошёл до конца
 * трека (валидацию делает сервер — итог подтверждается появлением x5sec).
 */
export async function dragBaxiaSlider(page, handle, { endX, rng = Math.random, profile = "human2", telemetry, tryIndex } = {}) {
  const box = await handle.el.boundingBox();
  if (!box) return false;
  const geometry = computeSliderDragGeometry(box, handle.selector);
  if (!geometry) return false;
  const { startX, endX: trackEnd } = geometry;
  const startY = box.y + box.height / 2;
  const track = endX ?? trackEnd;
  telemetry?.record?.("slider_geometry", {
    tryIndex, selector: handle.selector, fromTrack: geometry.fromTrack,
    startX: Math.round(startX), track: Math.round(track), frameUrl: (handle.frameUrl || "").slice(0, 120),
    box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
  });

  if (profile === "human2" || profile === "wind") {
    const timeline = profile === "wind"
      ? buildWindMouseDragTimeline({ start: startX, end: track, rng })
      : buildHumanDragTimeline({ start: startX, end: track, rng });
    telemetry?.record?.("solver_timeline", {
      profile, tryIndex, startX: Math.round(startX), track: Math.round(track),
      startY: Math.round(startY), moves: timeline.moves, version: timeline.version,
    });
    let isDown = false;
    for (const move of timeline.moves) {
      if (move.dtMs) await page.waitForTimeout(Math.round(move.dtMs));
      const y = startY + move.y;
      if (move.type === "approach") {
        await page.mouse.move(move.x, y, { steps: 1 });
      } else if (move.type === "down") {
        await page.mouse.move(move.x, y, { steps: 1 });
        await page.mouse.down();
        isDown = true;
      } else if (move.type === "drag") {
        await page.mouse.move(move.x, y, { steps: 1 });
      } else if (move.type === "pause") {
        // держим кнопку на месте — без движения
      } else if (move.type === "up") {
        await page.mouse.up();
        isDown = false;
      }
    }
    if (isDown) await page.mouse.up(); // страховка от зависшего mousedown
    // Диагностика (телеметрия 2026-09-25): после драга проверяем, СДВИНУЛАСЬ ЛИ
    // ручка. Если deltaX ≈ 0 — события мыши не дошли до виджета AWSC (не тот
    // iframe/элемент), и виноват не профиль траектории, а попадание в слайдер.
    try {
      const after = await handle.el.boundingBox();
      if (after) {
        telemetry?.record?.("slider_after_drag", {
          profile, tryIndex,
          handleXBefore: Math.round(startX),
          handleXAfter: Math.round(after.x + after.width / 2),
          deltaX: Math.round(after.x + after.width / 2 - startX),
          trackEnd: Math.round(track),
        });
      }
    } catch {}
    return true;
  }

  // Профиль 1 (legacy): easeOut-драг v1.
  const steps = 20 + Math.floor(rng() * 15);
  const path = buildDragPath({ start: startX, end: track, steps, jitter: 2.5, rng, overshootPx: 6 + rng() * 8 });

  await page.mouse.move(startX, startY, { steps: 2 });
  await page.waitForTimeout(80 + rng() * 120);
  await page.mouse.down();
  for (const p of path) {
    if (p.dtMs) await page.waitForTimeout(p.dtMs);
    await page.mouse.move(p.x, startY + p.y, { steps: 1 });
  }
  await page.waitForTimeout(60 + rng() * 140);
  await page.mouse.up();
  return true;
}

/**
 * Полный цикл: дождаться слайдера, продрагать, дождаться x5sec.
 * Возвращает { solved: boolean, tries: number, error?: string }.
 */
export async function trySolveBaxiaOnPage(page, cfg = resolveBaxiaSolverConfig(), { log, telemetry } = {}) {
  const started = Date.now();
  for (let i = 1; i <= cfg.maxTries; i += 1) {
    if (Date.now() - started > cfg.totalTimeoutMs) {
      return { solved: false, tries: i - 1, error: "solver_timeout" };
    }
    const handle = await waitForBaxiaSlider(page, { timeoutMs: 15_000, log });
    if (!handle) return { solved: false, tries: i, error: "slider_not_found" };
    // Телеметрия 2026-09-25: initialize.jsonp AWSC завершился на 631мс ПОЗЖЕ
    // нашего первого драга — виджет ещё не был готов принимать ввод (после
    // драгов ни одного fourier-репорта). Даём виджету инициализироваться:
    // статичный барьер (initialize виден не из всех фреймов) + человеческая
    // реакция на появление слайдера.
    if (i === 1) {
      await page.waitForTimeout(600 + Math.random() * 700);
      log?.("widget warm-up delay applied");
    }
    log?.(`drag try ${i}/${cfg.maxTries} (profile ${cfg.dragProfile}, selector ${handle.selector})`);
    const dragged = await dragBaxiaSlider(page, handle, { profile: cfg.dragProfile, telemetry, tryIndex: i });
    if (!dragged) continue;
    // Ждём setCookieSuccess: x5sec появляется в cookies страницы.
    const ok = await waitForX5Sec(page, cfg.settleMs * 3 + 4_000);
    if (ok) return { solved: true, tries: i };
    log?.(`try ${i}: x5sec not set after drag`);
  }
  return { solved: false, tries: cfg.maxTries, error: "x5sec_timeout" };
}

/** Ждать появления cookie x5sec в контексте страницы. */
export async function waitForX5Sec(page, timeoutMs = 10_000, pollMs = 500) {
  const deadline = Date.now() + Math.max(500, timeoutMs);
  while (Date.now() < deadline) {
    try {
      const cookies = await page.context().cookies();
      if (hasX5SecCookie(cookies)) return true;
    } catch {
      // контекст мог закрыться
    }
    await page.waitForTimeout(pollMs);
  }
  return false;
}
