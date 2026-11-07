import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { wipeBrowserProfileDir } from "../src/providers/qwen/browser-login.mjs";

let tmp;

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-fresh-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe("wipeBrowserProfileDir: полный сброс профиля перед логин-окном", () => {
  it("Chromium-профиль (Default/ + Local State) стирается целиком", () => {
    const prof = path.join(tmp, "browser-profile");
    fs.mkdirSync(path.join(prof, "Default", "Local Storage"), { recursive: true });
    fs.writeFileSync(path.join(prof, "Local State"), "{}");
    fs.writeFileSync(path.join(prof, "Default", "Cookies"), "session-data");
    const res = wipeBrowserProfileDir(prof);
    assert.equal(res.wiped, true);
    assert.equal(fs.existsSync(prof), false, "каталог профиля удалён");
  });

  it("НЕ трогает каталог, не похожий на Chromium-профиль (защита от мисконфига)", () => {
    const danger = path.join(tmp, "important-dir");
    fs.mkdirSync(danger);
    fs.writeFileSync(path.join(danger, "notes.txt"), "не трогай");
    const res = wipeBrowserProfileDir(danger);
    assert.equal(res.wiped, false);
    assert.equal(res.reason, "not a chromium profile");
    assert.equal(fs.readFileSync(path.join(danger, "notes.txt"), "utf8"), "не трогай");
  });

  it("отсутствующий каталог — no-op без исключения", () => {
    const res = wipeBrowserProfileDir(path.join(tmp, "no-such-profile"));
    assert.equal(res.wiped, false);
    assert.equal(res.reason, "not exists");
  });

  it("пустой каталог — no-op", () => {
    const empty = path.join(tmp, "empty-profile");
    fs.mkdirSync(empty);
    const res = wipeBrowserProfileDir(empty);
    assert.equal(res.wiped, false);
    assert.equal(res.reason, "already empty");
  });

  it("пустой путь/не-строка — no-op", () => {
    assert.equal(wipeBrowserProfileDir("").wiped, false);
    assert.equal(wipeBrowserProfileDir(null).wiped, false);
  });
});
