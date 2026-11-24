import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureChromiumBinary, ensureBrowserBinaries } from '../src/browser/ensure-binaries.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-chromium-'));
  const binary = path.join(root, 'chrome');
  return { root, binary, engine: { name: 'patchright', chromium: { executablePath: () => binary } } };
}

test('an installed selected engine does not require the unused Chromium runtime', () => {
  const { root, binary, engine } = fixture();
  try {
    fs.writeFileSync(binary, 'binary');
    assert.deepEqual(ensureChromiumBinary(engine, { install: () => assert.fail('must not reinstall') }), { ok: true, engine: 'patchright' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('only the selected engine is installed once and its actual executable is rechecked', () => {
  const { root, binary, engine } = fixture(), calls = [];
  try {
    const install = (_label, args) => { calls.push(args); fs.writeFileSync(binary, 'binary'); return true; };
    assert.equal(ensureChromiumBinary(engine, { install }).ok, true);
    assert.equal(ensureChromiumBinary(engine, { install }).ok, true);
    assert.deepEqual(calls, [['patchright', 'install', 'chromium']]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('quiet checks never install; failed installation names the selected engine', () => {
  const { root, engine } = fixture();
  try {
    assert.equal(ensureChromiumBinary(engine, { quiet: true, install: () => assert.fail() }).ok, false);
    const failed = ensureChromiumBinary(engine, { install: () => false });
    assert.equal(failed.ok, false);
    assert.match(failed.error, /npx patchright install chromium/);
    assert.doesNotMatch(failed.error, /playwright install/);
    const absent = ensureChromiumBinary(engine, { install: () => true });
    assert.equal(absent.ok, false, 'exit zero without a binary must not count as installed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('the real quiet check resolves only the engine used by Chromium components', async () => {
  const { getChatGPTChromium, getChatGPTEngineName } = await import('../src/providers/chatgpt/engine.mjs');
  await getChatGPTChromium();
  const result = await ensureBrowserBinaries({ quiet: true });
  assert.equal(result.engine, getChatGPTEngineName());
  assert.doesNotMatch(result.engine, /\+/);
});
