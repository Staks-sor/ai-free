import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeAtomicJsonSync, writeAtomicJson, createJsonStateWriter } from '../src/state/state-writer.mjs';

function fixture() { return fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-state-writer-')); }

test('failed atomic replacement keeps the previous state readable and removes temporary files', () => {
  const root = fixture(), file = path.join(root, 'state.json'), backupFile = path.join(root, 'backup.json');
  const rename = fs.renameSync;
  try {
    writeAtomicJsonSync(file, { value: 1 }, { backupFile });
    fs.renameSync = (source, target) => { if (target === file) throw new Error('rename failed'); return rename(source, target); };
    assert.throws(() => writeAtomicJsonSync(file, { value: 2 }, { backupFile }), /rename failed/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), { value: 1 });
    assert.deepEqual(JSON.parse(fs.readFileSync(backupFile)), { value: 1 });
    assert.deepEqual(fs.readdirSync(root).sort(), ['backup.json', 'state.json']);
  } finally { fs.renameSync = rename; fs.rmSync(root, { recursive: true, force: true }); }
});

test('a corrupt primary never replaces a valid backup', () => {
  const root = fixture(), file = path.join(root, 'state.json'), backupFile = path.join(root, 'backup.json');
  try {
    fs.writeFileSync(file, '{broken'); fs.writeFileSync(backupFile, '{"value":1}');
    writeAtomicJsonSync(file, { value: 2 }, { backupFile });
    assert.deepEqual(JSON.parse(fs.readFileSync(backupFile)), { value: 1 });
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), { value: 2 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('writer coalesces updates and serializes writes, including updates arriving during I/O', async () => {
  const writes = []; let release;
  const writer = createJsonStateWriter('unused', { write: async (_file, value) => {
    writes.push(value);
    if (writes.length === 1) await new Promise(resolve => { release = resolve; });
  } });
  writer.schedule({ value: 1 }); writer.schedule({ value: 2 });
  const flushing = writer.flush();
  await Promise.resolve();
  assert.equal(writes.length, 1);
  writer.schedule({ value: 3 }); writer.schedule({ value: 4 });
  const secondFlush = writer.flush(); release();
  await Promise.all([flushing, secondFlush]);
  assert.deepEqual(writes, [{ value: 2 }, { value: 4 }]);
});

test('flush reports a failure and a later explicit flush can recover the pending snapshot', async () => {
  let fail = true, saved;
  const writer = createJsonStateWriter('unused', { write: async (_file, value) => {
    if (fail) throw new Error('disk unavailable'); saved = value;
  } });
  writer.schedule({ value: 1 });
  await assert.rejects(writer.flush(), /disk unavailable/);
  fail = false; await writer.flush();
  assert.deepEqual(saved, { value: 1 });
});

test('every concurrent flush waits until the snapshot queued before it is written', async () => {
  const releases = [], writes = [];
  const writer = createJsonStateWriter('unused', { write: async (_file, value) => {
    writes.push(value); await new Promise(resolve => releases.push(resolve));
  } });
  writer.schedule(1); const first = writer.flush(); await Promise.resolve();
  writer.schedule(2); let secondDone = false;
  const second = writer.flush().then(() => { secondDone = true; });
  releases[0]();
  while (writes.length < 2) await new Promise(resolve => setImmediate(resolve));
  assert.equal(secondDone, false);
  releases[1](); await Promise.all([first, second]);
});


test('asynchronous atomic writes preserve a valid backup and clean up failed replacement', async () => {
  const root = fixture(), file = path.join(root, 'state.json'), backupFile = path.join(root, 'backup.json');
  const rename = fs.promises.rename;
  try {
    await writeAtomicJson(file, { value: 1 }, { backupFile });
    await writeAtomicJson(file, { value: 2 }, { backupFile });
    assert.deepEqual(JSON.parse(fs.readFileSync(backupFile)), { value: 1 });
    fs.promises.rename = async (source, target) => {
      if (target === file) throw new Error('rename failed'); return rename(source, target);
    };
    await assert.rejects(writeAtomicJson(file, { value: 3 }, { backupFile }), /rename failed/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), { value: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(backupFile)), { value: 2 });
    assert.deepEqual(fs.readdirSync(root).sort(), ['backup.json', 'state.json']);
  } finally { fs.promises.rename = rename; fs.rmSync(root, { recursive: true, force: true }); }
});
