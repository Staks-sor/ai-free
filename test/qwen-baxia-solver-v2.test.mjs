import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDragPath,
  buildHumanDragTimeline,
  buildWindMouseDragTimeline,
  isBaxiaPunishUrl,
  isBaxiaNavigationError,
  isBaxiaGuardedUrl,
  computeSliderDragGeometry,
  hasX5SecCookie,
  resolveBaxiaSolverConfig,
} from "../src/providers/qwen/baxia-solver.mjs";

// Детерминированный rng для тестов.
const seededRng = (seed) => () => {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
};

describe("baxia-solver v2: human drag timeline", () => {
  it("buildHumanDragTimeline: возвращает полный профиль движения", () => {
    const timeline = buildHumanDragTimeline({
      start: 100,
      end: 360,
      rng: seededRng(11),
    });
    assert.ok(Array.isArray(timeline.moves));
    assert.ok(timeline.moves.length >= 25, `expected >=25 moves, got ${timeline.moves.length}`);
    // Первый ход — наведение на ручку (клик по ручке до mousedown).
    assert.equal(timeline.moves[0].type, "approach");
    // mousedown присутствует ровно один
    const downs = timeline.moves.filter((m) => m.type === "down");
    assert.equal(downs.length, 1);
    // драг монотонен (без учёта микро-джиттера): последний drag-ход >= первого
    const drags = timeline.moves.filter((m) => m.type === "drag");
    assert.ok(drags.length >= 20);
    assert.ok(drags[drags.length - 1].x > drags[0].x);
    // финальный ход — mouseup у правого края трека
    const ups = timeline.moves.filter((m) => m.type === "up");
    assert.equal(ups.length, 1);
    assert.ok(Math.abs(ups[0].x - 360) <= 4, `up.x=${ups[0].x}`);
    // y-дрейф есть, но небольшой (в пределах ±5px)
    for (const m of drags) assert.ok(Math.abs(m.y) <= 5, `y drift too big: ${m.y}`);
  });

  it("buildHumanDragTimeline: тот же rng → тот же таймлайн", () => {
    const a = buildHumanDragTimeline({ start: 0, end: 260, rng: seededRng(3) });
    const b = buildHumanDragTimeline({ start: 0, end: 260, rng: seededRng(3) });
    assert.deepEqual(a, b);
  });

  it("buildHumanDragTimeline: реакция человека — первая drag-задержка > 40ms", () => {
    const timeline = buildHumanDragTimeline({ start: 0, end: 260, rng: seededRng(9) });
    const firstDrag = timeline.moves.find((m) => m.type === "drag");
    assert.ok(firstDrag.dtMs >= 40, `first drag dtMs=${firstDrag.dtMs}`);
  });
});

describe("baxia-solver: punish URL detection", () => {
  it("isBaxiaPunishUrl: распознаёт punish-адреса", () => {
    assert.equal(isBaxiaPunishUrl("https://chat.qwen.ai/api/v2/chat/completions/_____tmd_____/punish?x5secdata=x&x5step=2&action=captcha"), true);
    assert.equal(isBaxiaPunishUrl("https://chat.qwen.ai//api/v2/chat/completions/_____tmd_____/punish?x5secdata=x"), true);
    assert.equal(isBaxiaPunishUrl("https://chat.qwen.ai/api/v2/chat/completions/_____tmd_____/punishTextFetch?x5secdata=x"), true);
    assert.equal(isBaxiaPunishUrl("https://chat.qwen.ai/c/new-chat"), false);
    assert.equal(isBaxiaPunishUrl("https://chat.qwen.ai/"), false);
    assert.equal(isBaxiaPunishUrl(""), false);
    assert.equal(isBaxiaPunishUrl(null), false);
  });

  it("isBaxiaNavigationError: только navigation-ошибки, не таймауты", () => {
    assert.equal(isBaxiaNavigationError(new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation.")), true);
    assert.equal(isBaxiaNavigationError(new Error("net::ERR_ABORTED at https://chat.qwen.ai/")), true);
    assert.equal(isBaxiaNavigationError(new Error("qwen_page_evaluate_timeout")), false);
    assert.equal(isBaxiaNavigationError(new Error("Timeout 30000ms exceeded")), false);
    assert.equal(isBaxiaNavigationError(null), false);
    assert.equal(isBaxiaNavigationError(""), false);
  });

  it("isBaxiaGuardedUrl: punish-детект нужен и для chats/new (лог 2026-09-25)", () => {
    assert.equal(isBaxiaGuardedUrl("https://chat.qwen.ai/api/v2/chat/completions?chat_id=x"), true);
    assert.equal(isBaxiaGuardedUrl("https://chat.qwen.ai/api/v2/chats/new"), true);
    assert.equal(isBaxiaGuardedUrl("https://chat.qwen.ai/api/v2/models/"), false);
    assert.equal(isBaxiaGuardedUrl("https://chat.qwen.ai/c/abc"), false);
    assert.equal(isBaxiaGuardedUrl(""), false);
    assert.equal(isBaxiaGuardedUrl(null), false);
  });

  it("computeSliderDragGeometry: трек scale_text драг от левого края, ручка — от центра", () => {
    // Трек: x=380 w=520 h=40 → ручка-квадрат ~20px: драг 390..880
    const track = computeSliderDragGeometry({ x: 380, y: 200, width: 520, height: 40 }, "div#nc_1__scale_text");
    assert.ok(track.fromTrack);
    assert.equal(track.startX, 400); // 380 + h/2=20
    assert.equal(track.endX, 880);   // 380 + 520 - 20
    // Ручка: центр элемента, тянем на +300
    const handle = computeSliderDragGeometry({ x: 390, y: 200, width: 40, height: 40 }, "span.nc_1_n1z");
    assert.equal(handle.fromTrack, false);
    assert.equal(handle.startX, 410);
    assert.equal(handle.endX, 710);
    // Плохой box → null
    assert.equal(computeSliderDragGeometry(null, "span.nc_1_n1z"), null);
    assert.equal(computeSliderDragGeometry({}, "span.nc_1_n1z"), null);
  });
});

describe("baxia-solver: config", () => {
  it("resolveBaxiaSolverConfig: новые ручки drag v2", () => {
    const cfg = resolveBaxiaSolverConfig({ QWEN_BAXIA_DRAG_PROFILE: "0" });
    assert.equal(cfg.dragProfile, "0");
    const cfg2 = resolveBaxiaSolverConfig({});
    assert.equal(cfg2.dragProfile, "human2");
    const cfg3 = resolveBaxiaSolverConfig({ QWEN_BAXIA_SOLVE_MAX_TRIES: "5" });
    assert.equal(cfg3.maxTries, 5);
  });

  it("resolveBaxiaSolverConfig: профиль wind валиден", () => {
    assert.equal(resolveBaxiaSolverConfig({ QWEN_BAXIA_DRAG_PROFILE: "wind" }).dragProfile, "wind");
  });
});

describe("baxia-solver: WindMouse drag timeline (физическая модель)", () => {
  it("buildWindMouseDragTimeline: корректная структура таймлайна", () => {
    const tl = buildWindMouseDragTimeline({ start: 100, end: 380, rng: seededRng(21) });
    assert.equal(tl.profile, "wind");
    assert.ok(Array.isArray(tl.moves));
    assert.ok(tl.moves.length >= 20, `expected >=20 moves, got ${tl.moves.length}`);
    // один down, один up
    assert.equal(tl.moves.filter((m) => m.type === "down").length, 1);
    assert.equal(tl.moves.filter((m) => m.type === "up").length, 1);
    // down раньше up
    const downIdx = tl.moves.findIndex((m) => m.type === "down");
    const upIdx = tl.moves.findIndex((m) => m.type === "up");
    assert.ok(downIdx < upIdx);
    // драг достигает конца: последний drag/up близок к end
    const lastX = Math.max(...tl.moves.filter((m) => m.type === "drag").map((m) => m.x));
    assert.ok(lastX >= 375, `last drag x=${lastX}, expected >= 375 (end=380)`);
    // y-колебания ограничены
    for (const m of tl.moves) {
      if (m.type === "drag" || m.type === "approach") assert.ok(Math.abs(m.y) <= 6, `y too big: ${m.y}`);
    }
  });

  it("buildWindMouseDragTimeline: монотонный прогресс к цели (гравитация)", () => {
    const tl = buildWindMouseDragTimeline({ start: 0, end: 300, rng: seededRng(5) });
    const drags = tl.moves.filter((m) => m.type === "drag");
    // допускаем редкие микро-откаты ветром (<= 3px), но общий тренд строго вперёд
    let regressions = 0;
    for (let i = 1; i < drags.length; i += 1) {
      if (drags[i].x < drags[i - 1].x - 3) regressions += 1;
    }
    assert.ok(regressions <= 2, `too many regressions: ${regressions}`);
    assert.ok(drags[drags.length - 1].x > drags[0].x);
  });

  it("buildWindMouseDragTimeline: детерминирован при одинаковом rng", () => {
    const a = buildWindMouseDragTimeline({ start: 0, end: 260, rng: seededRng(9) });
    const b = buildWindMouseDragTimeline({ start: 0, end: 260, rng: seededRng(9) });
    assert.deepEqual(a, b);
  });

  it("buildWindMouseDragTimeline: нелинейность — есть вариация интервалов dtMs", () => {
    const tl = buildWindMouseDragTimeline({ start: 0, end: 260, rng: seededRng(13) });
    const dts = tl.moves.filter((m) => m.type === "drag").map((m) => m.dtMs);
    const uniq = new Set(dts);
    assert.ok(uniq.size >= 5, `dtMs too uniform: ${[...uniq].join(",")}`);
  });
});
