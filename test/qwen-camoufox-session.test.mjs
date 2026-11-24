import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { saveCamoufoxFingerprint } from "../src/browser/camoufox-runtime.mjs";
import { qwenCamoufoxOptions } from "../src/providers/qwen/camoufox-session.mjs";
import { readInitialStorageState } from '../src/browser/storage-bootstrap.mjs';

for (const prefix of ['', 'plugin-for-vscode/']) {
  test(prefix + ' Qwen retains a real browser profile and imports portable auth only once', async t => {
    const { qwenCamoufoxOptions: optionsFor } = await import('../' + prefix + 'src/providers/qwen/camoufox-session.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-persistent-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const state = { cookies: [{ name: 'refresh_token', value: 'synthetic' }], origins: [] };
    fs.writeFileSync(path.join(dir, 'auth.json'), '{}');
    fs.writeFileSync(path.join(dir, 'camoufox-storage-state.json'), JSON.stringify(state));
    const first = optionsFor(dir, true), restarted = optionsFor(dir, false);
    assert.equal(first.profileDir, path.join(dir, 'camoufox-profile'));
    assert.equal(restarted.profileDir, first.profileDir, 'login and requests must reuse one browser profile');
    assert.notEqual(optionsFor(dir + '-other', true).profileDir, first.profileDir);
    assert.deepEqual(readInitialStorageState(first.profileDir, first.storageStatePath), state);
    fs.mkdirSync(first.profileDir);
    fs.writeFileSync(path.join(first.profileDir, 'prefs.js'), '// native profile');
    assert.equal(readInitialStorageState(first.profileDir, first.storageStatePath), null, 'portable state must not overwrite a renewed native profile');
  });
}

test("Qwen Camoufox uses an account-specific browser state for login and requests", () => {
  const first = qwenCamoufoxOptions("/tmp/qwen-account-a", true);
  const second = qwenCamoufoxOptions("/tmp/qwen-account-b", false);
  assert.equal(first.headless, true);
  assert.equal(second.headless, false);
  assert.equal(first.storageStatePath, "/tmp/qwen-account-a/camoufox-storage-state.json");
  assert.equal(second.storageStatePath, "/tmp/qwen-account-b/camoufox-storage-state.json");
  assert.notEqual(first.storageStatePath, second.storageStatePath);
  assert.equal(first.fingerprintStatePath, "/tmp/qwen-account-a/camoufox-fingerprint.json");
  assert.equal(second.fingerprintStatePath, "/tmp/qwen-account-b/camoufox-fingerprint.json");
});

test("Qwen keeps its first Camoufox fingerprint across later launches", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-fingerprint-test-"));
  try {
    const file = path.join(dir, "fingerprint.json");
    saveCamoufoxFingerprint({ env: { CAMOU_CONFIG_1: JSON.stringify({ "navigator.userAgent": "first", "canvas:seed": 123 }) } }, file);
    saveCamoufoxFingerprint({ env: { CAMOU_CONFIG_1: JSON.stringify({ "navigator.userAgent": "second", "canvas:seed": 456 }) } }, file);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { "navigator.userAgent": "first", "canvas:seed": 123 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
