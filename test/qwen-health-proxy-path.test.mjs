import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { qwenHealthRequestPath, qwenHealthSyncsMintedToken } from "../src/providers/qwen/account-health.mjs";

// 2026-09-30 вечер: health-check пинговал chat.qwen.ai СОХРАНЁННЫМ токеном
// из accounts.json напрямую (без прокси). После cookie_gate v2 сохранённый
// токен мёртв через 15–60 мин → ВСЕ 12 аккаунтов легли в invalid за один
// прогон менюшки, включая живых (epyd работал за час до проверки).
// Контракт: health должен идти через прокси-воркер (SPA-минт + подписанный
// fetch), прямой fetch из Node — только fallback.
describe("qwenHealthRequestPath", () => {
  it("прокси живой → путь 'proxy' (через SPA-воркер)", () => {
    assert.equal(qwenHealthRequestPath({ hasProxy: true }), "proxy");
  });

  it("прокси нет → путь 'direct' (последнее средство)", () => {
    assert.equal(qwenHealthRequestPath({ hasProxy: false }), "direct");
  });
});

// 2026-10-02: прокси-путь врал «недействителен» на ЖИВОЙ аккаунт (nenigumi,
// /chats success:true на свежем минте): proxyApiGet стрелял до завершения
// SPA-минта с протухшим Bearer из localStorage. Health обязан ждать минт.
describe("qwenHealthSyncsMintedToken", () => {
  it("минт с будущим exp → синкаем слот токеном", () => {
    assert.equal(qwenHealthSyncsMintedToken({ mintedTokenExp: 1_000_000, nowSec: 999_000 }), true);
  });

  it("минт протухший/отсутствует → не синкаем", () => {
    assert.equal(qwenHealthSyncsMintedToken({ mintedTokenExp: 999_000, nowSec: 1_000_000 }), false);
    assert.equal(qwenHealthSyncsMintedToken({ mintedTokenExp: null, nowSec: 1_000_000 }), false);
  });
});
