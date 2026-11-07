import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createTelemetryRecorder,
  shouldRecordTelemetry,
  scrubSecrets,
} from "../src/providers/qwen/telemetry-recorder.mjs";

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "qwen-telemetry-test-"));

// Минимальные фейки Playwright-объектов.
const fakePage = (overrides = {}) => ({
  url: () => "https://chat.qwen.ai/c/abc",
  on: () => {},
  ...overrides,
});

const fakeContext = ({ pages = [fakePage()] } = {}) => ({
  on: () => {},
  pages: () => pages,
  ...({} ),
});

describe("telemetry-recorder: env flag", () => {
  it("shouldRecordTelemetry: 1/true включают", () => {
    assert.equal(shouldRecordTelemetry({ QWEN_TELEMETRY: "1" }), true);
    assert.equal(shouldRecordTelemetry({ QWEN_TELEMETRY: "true" }), true);
    assert.equal(shouldRecordTelemetry({ QWEN_TELEMETRY: "yes" }), true);
    assert.equal(shouldRecordTelemetry({}), false);
    assert.equal(shouldRecordTelemetry({ QWEN_TELEMETRY: "0" }), false);
    assert.equal(shouldRecordTelemetry({ QWEN_TELEMETRY: "false" }), false);
  });
});

describe("telemetry-recorder: scrub secrets", () => {
  it("scrubSecrets: вырезает Authorization/токены/пароли", () => {
    const dirty = {
      Authorization: "Bearer eyJhbGciOi.secret",
      headers: { authorization: "Bearer xyz" },
      token: "supersecret",
      nested: { password: "hunter2", Token: "abc" },
      url: "https://x/api?token=abc123&sig=zzz",
      plain: "ok",
    };
    const clean = scrubSecrets(dirty);
    assert.equal(clean.Authorization, "[REDACTED]");
    assert.equal(clean.headers.authorization, "[REDACTED]");
    assert.equal(clean.token, "[REDACTED]");
    assert.equal(clean.nested.password, "[REDACTED]");
    assert.equal(clean.nested.Token, "[REDACTED]");
    assert.ok(!clean.url.includes("abc123"));
    assert.equal(clean.plain, "ok");
  });

  it("scrubSecrets: не падает на циклических и примитивах", () => {
    assert.equal(scrubSecrets("str"), "str");
    assert.equal(scrubSecrets(42), 42);
    assert.equal(scrubSecrets(null), null);
    const cyclic = { a: 1 };
    cyclic.self = cyclic;
    const out = scrubSecrets(cyclic);
    assert.equal(out.a, 1);
    assert.ok(out.self === "[Circular]" || typeof out.self === "string");
  });
});

describe("telemetry-recorder: запись событий", () => {
  let root;
  beforeEach(() => { root = tmpRoot(); });
  afterEach(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

  it("createTelemetryRecorder: пишет события в events.jsonl", async () => {
    const rec = createTelemetryRecorder({ root, label: "acc1" });
    assert.ok(rec.dir.startsWith(root), `dir=${rec.dir}`);
    rec.record("nav", { url: "https://chat.qwen.ai/_____tmd_____/punish?x=1" });
    rec.record("solver", { profile: "wind", moves: 56 });
    await rec.flush();
    const file = path.join(rec.dir, "events.jsonl");
    assert.ok(fs.existsSync(file));
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    const ev1 = JSON.parse(lines[0]);
    assert.equal(ev1.type, "nav");
    assert.equal(ev1.data.url.includes("_____tmd_____/punish"), true);
    assert.ok(typeof ev1.ts === "number");
    // run-manifest
    const manifest = JSON.parse(fs.readFileSync(path.join(rec.dir, "manifest.json"), "utf8"));
    assert.equal(manifest.label, "acc1");
    await rec.close();
  });

  it("createTelemetryRecorder: при навигации на punish пишет координаты мыши", async () => {
    const rec = createTelemetryRecorder({ root, label: "acc1" });
    let mouseCb;
    const page = fakePage({
      on: (ev, cb) => { if (ev === "framenavigated") mouseCb = cb; },
    });
    rec.attachToPage(page, "page0");
    // вручную дёргаем листенер: punish-навигация
    assert.ok(mouseCb, "framenavigated listener attached");
    await mouseCb({ url: () => "https://chat.qwen.ai/_____tmd_____/punish?x5step=2" });
    await rec.flush();
    const lines = fs.readFileSync(path.join(rec.dir, "events.jsonl"), "utf8").trim().split("\n");
    assert.ok(lines.some((l) => l.includes("\"punish_nav\"")), `no punish_nav in ${lines.length} lines`);
    await rec.close();
  });

  it("createTelemetryRecorder: ротация файла на 50 МБ", async () => {
    const rec = createTelemetryRecorder({ root, label: "acc1", rotateBytes: 200 });
    rec.record("solver", { blob: "x".repeat(150) });
    await rec.flush();
    rec.record("solver", { blob: "y".repeat(150) });
    await rec.flush();
    const files = fs.readdirSync(rec.dir).filter((f) => f.startsWith("events"));
    assert.ok(files.length >= 2, `expected rotation, got: ${files.join(",")}`);
    await rec.close();
  });
});
