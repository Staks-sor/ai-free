import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWindowStateStore } from '../src/state/window-state-store.mjs';

test('corrupt legacy store cannot silently read or commit an empty history', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-corrupt-state-')); const file = path.join(root, 'state.json');
  try {
    fs.writeFileSync(file, '{broken'); const store = createWindowStateStore(file, { conversations: [] });
    assert.throws(() => store.read(), error => error.code === 'STATE_CORRUPT');
    assert.throws(() => store.commit({ conversations: [] }), error => error.code === 'STATE_CORRUPT');
    await assert.rejects(store.commitAsync({ conversations: [] }), error => error.code === 'STATE_CORRUPT');
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
    assert.equal(fs.existsSync(file + '.revisions') && fs.readdirSync(file + '.revisions').some(n => n.endsWith('.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('window startup reports corrupt legacy data while a valid backup can restore it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-corrupt-startup-'));
  try {
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      import os from 'node:os'; import { syncBuiltinESMExports } from 'node:module';
      os.homedir = () => process.env.SYNVOX_CORRUPTION_TEST_ROOT; syncBuiltinESMExports();
      const fs = await import('node:fs'); const path = await import('node:path'); const assert = (await import('node:assert/strict')).default;
      const { loadWindowState, getStateFile, getStateBackupFile, createWindowStateWriter } = await import(${JSON.stringify(new URL('../src/state/window-state.mjs', import.meta.url).href)});
      assert.equal(loadWindowState('/project').conversations.length, 0);
      const file = getStateFile(); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{broken');
      assert.throws(() => loadWindowState('/project'), error => error.code === 'STATE_CORRUPT');
      fs.writeFileSync(getStateBackupFile(), JSON.stringify({ conversations: [{ id: 'restored', messages: [] }] }));
      const restored = loadWindowState('/project'); assert.equal(restored.conversations[0].id, 'restored');
      const writer = createWindowStateWriter('/project', restored); writer.schedule(restored); await writer.flush();
      assert.equal(loadWindowState('/project').conversations[0].id, 'restored');
      assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
    `], { env: { ...process.env, SYNVOX_CORRUPTION_TEST_ROOT: root }, timeout: 10000 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
