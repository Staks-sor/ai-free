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

export const BAXIA_SOLVER_VERSION = "baxia-nc-drag-v1";

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
  };
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
 * Найти ручку слайдера. Слайдер AWSC nc живёт в same-origin iframe
 * (baxia-dialog / nc-container). Same-origin => доступ к содержимому
 * фрейма разрешён. Пытаемся несколько селекторов и main-frame fallback.
 */
export async function findBaxiaSlider(page) {
  const selectors = [
    "span.nc_1_n1z", // ручка nc-слайдера
    "div.nc-lang-cnt span[role=button]", // fallback: ручка как role=button
    "div#nc_1__scale_text", // сам трек
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
          if (visible) return el;
        }
      } catch {
        // cross-origin frame или фрейм умер — пропускаем
      }
    }
  }
  return null;
}

/**
 * Решить слайдер человеческим драгом: hover → mousedown на ручке →
 * серия mouse.move по buildDragPath → mouse.up. Возвращает true,
 * если драг дошёл до конца трека (валидацию делает сервер — итог
 * подтверждается появлением x5sec).
 */
export async function dragBaxiaSlider(page, handle, { endX, rng = Math.random } = {}) {
  const box = await handle.boundingBox();
  if (!box) return false;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  // Трек шире ручки: тянем до правого края трека (+ запас на ширину ручки).
  const track = endX ?? Math.min(startX + 300, page.viewportSize?.()?.width - 40 || startX + 300);
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
export async function trySolveBaxiaOnPage(page, cfg = resolveBaxiaSolverConfig(), { log } = {}) {
  const started = Date.now();
  for (let i = 1; i <= cfg.maxTries; i += 1) {
    if (Date.now() - started > cfg.totalTimeoutMs) {
      return { solved: false, tries: i - 1, error: "solver_timeout" };
    }
    const handle = await waitForBaxiaSlider(page, { timeoutMs: 15_000, log });
    if (!handle) return { solved: false, tries: i, error: "slider_not_found" };
    log?.(`drag try ${i}/${cfg.maxTries}`);
    const dragged = await dragBaxiaSlider(page, handle, {});
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
