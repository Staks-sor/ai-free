import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWindowStateStore } from '../src/state/window-state-store.mjs';

const initial = () => ({ conversations: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], deletedConversationIds: [], activeByWorkspace: {}, pipeline: {} });
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-state-store-'));
  const file = path.join(root, 'state.json'); fs.writeFileSync(file, JSON.stringify(initial()));
  return { root, file, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('stale backends preserve independent chat edits and unchanged external additions', () => {
  const f = setup(); try {
    const a = createWindowStateStore(f.file, initial()), b = createWindowStateStore(f.file, initial());
    const one = initial(), two = initial(); one.conversations[0].title = 'new A'; two.conversations[1].title = 'new B';
    one.conversations.push({ id: 'c', title: 'C' });
    a.commit(one); b.commit(two);
    assert.deepEqual(b.read().conversations.map(c => c.title), ['new A', 'new B', 'C']);
    two.conversations[1].title = 'newer B'; b.commit(two);
    assert.equal(b.read().conversations[0].title, 'new A');
    assert.equal(fs.readdirSync(`${f.file}.revisions`).filter(p => p.endsWith('.json')).length, 2);
  } finally { f.dispose(); }
});

test('conflicting chat edits fail explicitly and preserve the committed state', () => {
  const f = setup(); try {
    const a = createWindowStateStore(f.file, initial()), b = createWindowStateStore(f.file, initial());
    const one = initial(), two = initial(); one.conversations[0].title = 'one'; two.conversations[0].title = 'two';
    a.commit(one);
    assert.throws(() => b.commit(two), error => error.code === 'STATE_CONFLICT');
    assert.equal(b.read().conversations[0].title, 'one');
  } finally { f.dispose(); }
});

test('an external deletion is not resurrected by an unrelated stale backend', () => {
  const f = setup(); try {
    const a = createWindowStateStore(f.file, initial()), b = createWindowStateStore(f.file, initial());
    const one = initial(); one.conversations.shift(); one.deletedConversationIds.push('a'); a.commit(one);
    const two = initial(); two.conversations[1].title = 'new B'; b.commit(two);
    assert.deepEqual(b.read().conversations.map(c => c.id), ['b']);
    two.conversations[0].title = 'resurrect';
    assert.throws(() => b.commit(two), error => error.code === 'STATE_CONFLICT');
  } finally { f.dispose(); }
});

test('restart uses the previous valid version if the latest is corrupted', () => {
  const f = setup(); try {
    const store = createWindowStateStore(f.file, initial()); store.commit(initial());
    const changed = initial(); changed.conversations[0].title = 'changed'; store.commit(changed);
    const files = fs.readdirSync(`${f.file}.revisions`).filter(n => n.endsWith('.json')).sort();
    fs.writeFileSync(path.join(`${f.file}.revisions`, files.at(-1)), '{broken');
    const restarted = createWindowStateStore(f.file, initial());
    assert.equal(restarted.read().conversations[0].title, 'A');
    restarted.commit(initial());
    assert.equal(restarted.read().conversations[0].title, 'A');
  } finally { f.dispose(); }
});

test('two real processes preserve changes from a shared stale snapshot', async () => {
  const { spawn } = await import('node:child_process');
  const f = setup();
  try {
    const script = `import { createWindowStateStore } from ${JSON.stringify(new URL('../src/state/window-state-store.mjs', import.meta.url).href)};
      import fs from 'node:fs';
      const initial = JSON.parse(fs.readFileSync(process.argv[1]));
      const store = createWindowStateStore(process.argv[1], initial);
      process.stdout.write('ready\\n');
      process.stdin.once('data', async () => { initial.conversations[Number(process.argv[2])].title = process.argv[3];
        try { for (let turn = 0; turn < 12; turn++) { initial.conversations[Number(process.argv[2])].title = process.argv[3] + '-' + turn; await store.commitAsync(initial); } process.exit(0); } catch(e) { console.error(e); process.exit(1); } });`;
    const children = [0, 1].map(i => spawn(process.execPath, ['--input-type=module', '-e', script, f.file, String(i), `process-${i}`], { stdio: ['pipe', 'pipe', 'pipe'] }));
    const exits = children.map(child => new Promise((resolve, reject) => {
      let error = ''; child.stderr.on('data', chunk => { error += chunk; });
      child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(error)));
    }));
    await Promise.all(children.map(child => new Promise(resolve => child.stdout.once('data', resolve))));
    children.forEach(child => child.stdin.end('commit'));
    await Promise.all(exits);
    assert.deepEqual(createWindowStateStore(f.file, initial()).read().conversations.map(c => c.title), ['process-0-11', 'process-1-11']);
  } finally { f.dispose(); }
});

test('a delayed writer cannot reuse a pruned revision and falsely acknowledge lost data', () => {
  const f = setup(), link = fs.linkSync;
  try {
    const first = createWindowStateStore(f.file, initial()); first.commit(initial());
    const slow = createWindowStateStore(f.file, initial()), fast = createWindowStateStore(f.file, initial());
    let delayed = true;
    fs.linkSync = (source, target) => {
      if (delayed) {
        delayed = false;
        for (let i = 0; i < 3; i++) { const state = initial(); state.conversations[1].title = `fast-${i}`; fast.commit(state); }
      }
      return link(source, target);
    };
    const state = initial(); state.conversations[0].title = 'slow'; slow.commit(state);
    assert.deepEqual(slow.read().conversations.map(c => c.title), ['slow', 'fast-2']);
  } finally { fs.linkSync = link; f.dispose(); }
});

test('a failed atomic commit leaves the prior checkpoint and removes its temporary file', async () => {
  const f = setup(), link = fs.promises.link;
  try {
    const store = createWindowStateStore(f.file, initial()); await store.commitAsync(initial());
    fs.promises.link = async () => { throw new Error('disk failure'); };
    const state = initial(); state.conversations[0].title = 'uncommitted';
    await assert.rejects(store.commitAsync(state), /disk failure/);
    assert.equal(store.read().conversations[0].title, 'A');
    assert.equal(fs.readdirSync(`${f.file}.revisions`).some(p => p.endsWith('.tmp')), false);
  } finally { fs.promises.link = link; f.dispose(); }
});

test('killing a writer before publication preserves state and later removes its orphan', async () => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const f = setup(); let child;
  try {
    const store = createWindowStateStore(f.file, initial()); store.commit(initial());
    const script = `import fs from 'node:fs'; import { createWindowStateStore } from ${JSON.stringify(new URL('../src/state/window-state-store.mjs', import.meta.url).href)};
      process.stdin.resume(); const value = JSON.parse(fs.readFileSync(process.argv[1]));
      const store = createWindowStateStore(process.argv[1], value); value.conversations[0].title = 'never published';
      fs.promises.link = async () => { process.stdout.write('staged'); await new Promise(() => {}); };
      await store.commitAsync(value);`;
    child = spawn(process.execPath, ['--input-type=module', '-e', script, f.file], { stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = once(child, 'exit'); await once(child.stdout, 'data'); child.kill('SIGKILL'); await exited;
    assert.equal(store.read().conversations[0].title, 'A');
    assert.ok(fs.readdirSync(`${f.file}.revisions`).some(n => n.endsWith('.tmp')));
    await store.commitAsync(initial());
    assert.equal(fs.readdirSync(`${f.file}.revisions`).some(n => n.endsWith('.tmp')), false);
  } finally { child?.kill(); f.dispose(); }
});

test('pipeline conflicts are explicit while independent workspace selections merge', () => {
  const f = setup(); try {
    const a = createWindowStateStore(f.file, initial()), b = createWindowStateStore(f.file, initial());
    const one = initial(), two = initial(); one.activeByWorkspace['/a'] = 'a'; two.activeByWorkspace['/b'] = 'b';
    one.pipeline = { mainAgentId: 'a' }; a.commit(one); b.commit(two);
    assert.deepEqual(b.read().activeByWorkspace, { '/a':'a', '/b':'b' });
    const third = createWindowStateStore(f.file, b.read()), fourth = createWindowStateStore(f.file, b.read());
    const changed = b.read(); changed.pipeline = { mainAgentId: 'b' }; third.commit(changed);
    const conflicting = two; conflicting.pipeline = { mainAgentId: 'different' };
    assert.throws(() => fourth.commit(conflicting), error => error.code === 'STATE_CONFLICT');
  } finally { f.dispose(); }
});

test('refresh imports external edits while preserving unsaved local changes and conflict detection', async () => {
  const f = setup(); try {
    const a = createWindowStateStore(f.file, initial()), b = createWindowStateStore(f.file, initial());
    const external = initial(); external.conversations[1].title = 'external'; a.commit(external);
    const local = initial(); local.conversations[0].title = 'unsaved';
    const refreshed = await b.refresh(() => local);
    assert.deepEqual(refreshed.conversations.map(c => c.title), ['unsaved', 'external']);
    b.commit(refreshed);
    assert.deepEqual(b.read().conversations.map(c => c.title), ['unsaved', 'external']);
    const conflictStore = createWindowStateStore(f.file, b.read());
    const changed = b.read(); changed.conversations[0].title = 'other'; createWindowStateStore(f.file, b.read()).commit(changed);
    const conflicting = refreshed; conflicting.conversations[0].title = 'mine';
    await assert.rejects(conflictStore.refresh(() => conflicting), e => e.code === 'STATE_CONFLICT');
  } finally { f.dispose(); }
});

test('refresh skips unchanged revision contents and reads local state after asynchronous I/O', async () => {
  const f = setup(), read = fs.promises.readFile;
  try {
    const a = createWindowStateStore(f.file, initial()), b = createWindowStateStore(f.file, initial());
    a.commit(initial()); const local = initial(); await b.refresh(() => local);
    fs.promises.readFile = async () => assert.fail('unchanged snapshot was parsed again');
    assert.equal(await b.refresh(() => local), null);
    const external = initial(); external.conversations[1].title = 'external'; a.commit(external);
    fs.promises.readFile = async (...args) => { local.conversations[0].title = 'changed during read'; return read(...args); };
    const result = await b.refresh(() => local);
    assert.deepEqual(result.conversations.map(c => c.title), ['changed during read', 'external']);
  } finally { fs.promises.readFile = read; f.dispose(); }
});
