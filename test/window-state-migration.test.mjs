import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('window APIs migrate legacy JSON, merge independent backends and reload new checkpoints', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-state-migration-'));
  try {
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
      const { loadWindowState, saveWindowState, createWindowStateWriter, getStateFile, getLegacyPerWorkspaceStateFile } = await import(${JSON.stringify(new URL('../src/state/window-state.mjs', import.meta.url).href)});
      const file = getStateFile(); fs.mkdirSync(path.dirname(file), { recursive: true });
      const emptyFirst = loadWindowState('/project'), emptySecond = loadWindowState('/project');
      emptySecond.conversations.push({ id:'external', title:'external', messages:[] }); saveWindowState('/project', emptySecond);
      emptyFirst.conversations.push({ id:'local', title:'local', messages:[] });
      const initialWriter = createWindowStateWriter('/project', emptyFirst); initialWriter.schedule(emptyFirst); await initialWriter.flush();
      assert.deepEqual(loadWindowState('/project').conversations.map(c => c.id).sort(), ['external', 'local']);
      fs.rmSync(file + '.revisions', { recursive:true, force:true });
      const legacy = { conversations: [{ id:'a', title:'A', messages:[] }, { id:'b', title:'B', messages:[] }] };
      const text = JSON.stringify(legacy); fs.writeFileSync(file, text);
      const first = loadWindowState('/project'), second = loadWindowState('/project');
      first.conversations[0].title = 'first'; saveWindowState('/project', first);
      second.conversations[1].harnessTask = { schemaVersion:1, id:'task', status:'paused', checkpoint:{ phase:'ready', prompt:'continue' } };
      const writer = createWindowStateWriter('/project', second); writer.schedule(second); await writer.flush();
      const restored = loadWindowState('/project');
      assert.equal(restored.conversations[0].title, 'first');
      assert.equal(restored.conversations[1].harnessTask.checkpoint.prompt, 'continue');
      const currentChat = second.conversations[1], currentTask = currentChat.harnessTask;
      const refresh = writer.refresh(); assert.equal(writer.refresh(), refresh); await refresh;
      assert.equal(second.conversations[0].title, 'first');
      assert.equal(second.conversations[1], currentChat);
      assert.equal(currentChat.harnessTask, currentTask);
      const remote = loadWindowState('/project'); remote.conversations.push({ id:'new', title:'New', messages:[] });
      remote.conversations = remote.conversations.filter(c => c.id !== 'a');
      remote.deletedConversationIds.push('a'); saveWindowState('/project', remote);
      await writer.refresh();
      assert.deepEqual(second.conversations.map(c => c.id).sort(), ['b','new']);
      currentTask.checkpoint.prompt = 'next'; writer.schedule(second); await writer.flush();
      assert.equal(loadWindowState('/project').conversations.find(c => c.id === 'b').harnessTask.checkpoint.prompt, 'next');
      assert.equal(fs.readFileSync(file, 'utf8'), text);
      assert.equal(restored.conversations[0].coderMode, true);
      const legacyFile = getLegacyPerWorkspaceStateFile('/other'); fs.mkdirSync(path.dirname(legacyFile), { recursive:true });
      const updatedLegacy = JSON.parse(JSON.stringify(restored));
      updatedLegacy.conversations.find(c => c.id === 'b').title = 'new legacy B';
      updatedLegacy.conversations.find(c => c.id === 'b').updatedAt = '2030-01-01';
      fs.writeFileSync(legacyFile, JSON.stringify(updatedLegacy));
      const mergedLegacy = loadWindowState('/project'); mergedLegacy.conversations.find(c => c.id === 'new').title = 'after legacy';
      const mergedWriter = createWindowStateWriter('/project', mergedLegacy); mergedWriter.schedule(mergedLegacy); await mergedWriter.flush();
      assert.equal(loadWindowState('/project').conversations.find(c => c.id === 'b').title, 'new legacy B');
    `], { cwd: root, env: { ...process.env, HOME: root }, timeout: 15000 });
    assert.equal(result.stderr, '');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
