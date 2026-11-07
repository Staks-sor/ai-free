import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createTelemetryRecorder,
  scrubSecrets,
  LOGIN_CAPTURE_KIND,
  shouldCaptureLoginTelemetry,
} from "../src/providers/qwen/telemetry-recorder.mjs";

const tmpRoot = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-login-capture-")); return d; };

// --- фейки Playwright (EventEmitter-подобные, ловим регистрируемые хендлеры) ---
function makeFakeContext() {
  const handlers = {};
  const ctx = {
    on: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
    pages: () => [],
    cookies: async () => [{ name: "token", value: "jwtjwt.jwt.jwt" }],
    _handlers: handlers,
  };
  return ctx;
}

function makeFakePage() {
  const handlers = {};
  return {
    url: () => "https://chat.qwen.ai/",
    on: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
    addInitScript: () => {},
    evaluate: async () => ({}),
    _handlers: handlers,
  };
}

// ответ-фейк для attachToContext
function fakeResponse({ url = "https://chat.qwen.ai/api/v2/chats?page_size=1", status = 200, body = '{"success":true}' } = {}) {
  return { url: () => url, status: () => status, text: async () => body };
}

let root;
beforeEach(() => { root = tmpRoot(); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe("telemetry-recorder: full login capture (F12-Network)", async () => {
  it("shouldCaptureLoginTelemetry: QWEN_LOGIN_TELEMETRY=1 или полный жучок включают login-capture", async () => {
    assert.equal(shouldCaptureLoginTelemetry({ QWEN_TELEMETRY: "1" }), true);
    assert.equal(shouldCaptureLoginTelemetry({ QWEN_LOGIN_TELEMETRY: "1" }), true);
    assert.equal(shouldCaptureLoginTelemetry({}), false);
  });

  it("capture=full: пишет http_request/http_response ВСЕХ запросов (не только антибот)", async () => {
    const rec = createTelemetryRecorder({ root, label: "login-test" });
    const ctx = makeFakeContext();
    rec.attachToContext(ctx, { capture: "full" });
    // прилетел произвольный запрос
    ctx._handlers["request"].forEach((fn) => fn({
      url: () => "https://chat.qwen.ai/api/v2/some/endpoint",
      method: () => "POST",
      postData: () => '{"a":1}',
      headers: () => ({ authorization: "Bearer xyz" }),
    }));
    await rec.flush();
    const lines = fs.readFileSync(path.join(rec.dir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const req = lines.find((l) => l.type === "http_request");
    assert.ok(req, "http_request должен быть записан");
    assert.equal(req.data.url, "https://chat.qwen.ai/api/v2/some/endpoint");
    assert.ok(!JSON.stringify(req).includes("Bearer xyz"), "секреты вырезаны");
  });

  it("capture=full: пишет http_response с телом и статусом", async () => {
    const rec = createTelemetryRecorder({ root, label: "login-test2" });
    const ctx = makeFakeContext();
    rec.attachToContext(ctx, { capture: "full" });
    ctx._handlers["response"].forEach((fn) => fn(fakeResponse()));
    await rec.flush();
    const lines = fs.readFileSync(path.join(rec.dir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const resp = lines.find((l) => l.type === "http_response");
    assert.ok(resp, "http_response записан");
    assert.equal(resp.data.status, 200);
    assert.ok(resp.data.body.includes("success"));
  });

  it("capture=full: лимит 40 кредитов ловится детектором в теле ответа (пороговое событие)", async () => {
    const rec = createTelemetryRecorder({ root, label: "login-test3" });
    const ctx = makeFakeContext();
    rec.attachToContext(ctx, { capture: "full" });
    ctx._handlers["response"].forEach((fn) => fn(fakeResponse({
      url: "https://chat.qwen.ai/api/v2/props",
      body: JSON.stringify({ success: true, data: { usage: { usedCredits: 40, totalCredits: 40 } } }),
    })));
    await rec.flush();
    const lines = fs.readFileSync(path.join(rec.dir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const ev = lines.find((l) => l.type === "credit_limit");
    assert.ok(ev, "credit_limit должен детектиться из usage-данных");
    assert.equal(ev.data.used, 40);
    assert.equal(ev.data.limit, 40);
  });

  it("capture=full: DOM-сигналы (лимит/капча) через console-мост, payload идёт в event", async () => {
    const rec = createTelemetryRecorder({ root, label: "login-test4" });
    const page = makeFakePage();
    rec.attachToPage(page, "login", { capture: "full" });
    // страница кинула мост-сообщение __qwen_tl через console
    page._handlers["console"].forEach((fn) => fn({
      text: () => '__qwen_tl {"kind":"credit_banner","used":40,"limit":40}',
    }));
    await rec.flush();
    const lines = fs.readFileSync(path.join(rec.dir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const ev = lines.find((l) => l.type === "dom_signal");
    assert.ok(ev, "dom_signal должен быть записан");
    assert.equal(ev.data.kind, "credit_banner");
    assert.equal(ev.data.used, 40);
  });

  it("capture=full: только main-frame навигации пишутся как navigation", async () => {
    const rec = createTelemetryRecorder({ root, label: "login-test5" });
    const page = makeFakePage();
    rec.attachToPage(page, "login", { capture: "full" });
    // iframe-навигация не пишется как navigation (frame !== mainFrame)
    const fakeFrame = { url: () => "https://cf.aliyun.com/slider" }; // !== page.mainFrame()
    page._handlers["framenavigated"].forEach((fn) => fn(fakeFrame));
    await rec.flush();
    const eventsFile = path.join(rec.dir, "events.jsonl");
    const lines = fs.existsSync(eventsFile)
      ? fs.readFileSync(eventsFile, "utf8").trim().split("\n").map((l) => JSON.parse(l))
      : [];
    assert.ok(!lines.some((l) => l.type === "navigation"), "iframe-навигация не пишется");
  });

  it("LOGIN_CAPTURE_KIND экспортируется", async () => {
    assert.equal(LOGIN_CAPTURE_KIND, "full");
  });
});
