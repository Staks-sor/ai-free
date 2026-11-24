import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readInitialStorageState, restoreInitialStorageState } from '../src/browser/storage-bootstrap.mjs';

test('imports a portable session only into a new or empty browser profile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-storage-bootstrap-'));
  try {
    const profile = path.join(root, 'profile');
    const file = path.join(root, 'state.json');
    const state = { cookies: [{ name: 'session', value: 'synthetic', domain: 'example.test' }], origins: [] };
    fs.writeFileSync(file, JSON.stringify(state));
    assert.deepEqual(readInitialStorageState(profile, file), state);
    fs.mkdirSync(profile);
    assert.deepEqual(readInitialStorageState(profile, file), state);
    fs.writeFileSync(path.join(profile, 'Preferences'), '{}');
    assert.equal(readInitialStorageState(profile, file), null);
    assert.equal(readInitialStorageState(path.join(root, 'missing'), path.join(root, 'absent')), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('restores cookies and origin-scoped storage without replacing values already present', async () => {
  let cookies, script, args;
  const context = {
    addCookies: async value => { cookies = value; },
    addInitScript: async (value, argument) => { script = value; args = argument; },
  };
  const state = {
    cookies: [{ name: 'session', value: 'synthetic', domain: 'example.test' }],
    origins: [{ origin: 'https://example.test', localStorage: [{ name: 'token', value: 'saved' }, { name: 'theme', value: 'light' }] }],
  };
  await restoreInitialStorageState(context, state);
  assert.deepEqual(cookies, state.cookies);
  const storage = new Map([['theme', 'dark']]);
  const sandbox = {
    location: { origin: 'https://other.test' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    args,
  };
  vm.runInNewContext(`(${script.toString()})(args)`, sandbox);
  assert.equal(storage.has('token'), false);
  sandbox.location.origin = 'https://example.test';
  vm.runInNewContext(`(${script.toString()})(args)`, sandbox);
  assert.equal(storage.get('token'), 'saved');
  assert.equal(storage.get('theme'), 'dark');
  await restoreInitialStorageState({}, null);
});
