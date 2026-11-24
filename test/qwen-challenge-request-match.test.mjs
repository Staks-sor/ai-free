import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { watchQwenPunishNavigation } from '../src/providers/qwen/browser-proxy.mjs';

function request(url, method = 'GET') {
  return { url: () => url, method: () => method };
}

async function waitForMatch(promise) {
  return Promise.race([
    promise.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 10)),
  ]);
}

test('punish watcher ignores marker URLs on unrelated origins', async () => {
  const page = new EventEmitter();
  const watch = watchQwenPunishNavigation(page);
  page.emit('request', request('https://other.example/api/v2/chat/completions/_____tmd_____/punish'));
  assert.equal(await waitForMatch(watch.promise), false);
  watch.dispose();
});

test('punish watcher ignores marker text in a query and unrelated Qwen endpoints', async t => {
  for (const url of [
    'https://chat.qwen.ai/api/v2/search?next=_____tmd_____/punish',
    'https://chat.qwen.ai/api/v2/profile/_____tmd_____/punish',
  ]) {
    await t.test(url, async () => {
      const page = new EventEmitter();
      const watch = watchQwenPunishNavigation(page);
      page.emit('request', request(url));
      assert.equal(await waitForMatch(watch.promise), false);
      watch.dispose();
    });
  }
});

test('punish watcher accepts the observed completion punish path, including GET redirects', async () => {
  const page = new EventEmitter();
  const watch = watchQwenPunishNavigation(page);
  page.emit('request', request('https://chat.qwen.ai//api/v2/chat/completions/_____tmd_____/punish', 'GET'));
  const result = await watch.promise;
  assert.equal(result.punish, true);
  watch.dispose();
});

test('punish watcher consults asynchronous active-turn predicate', async t => {
  for (const [active, expected] of [[false, false], [true, true]]) {
    await t.test(`active=${active}`, async () => {
      const page = new EventEmitter();
      const watch = watchQwenPunishNavigation(page, { isActive: async () => active });
      page.emit('request', request('https://chat.qwen.ai/api/v2/chat/completions/_____tmd_____/punish'));
      if (expected) assert.equal((await watch.promise).punish, true);
      else assert.equal(await waitForMatch(watch.promise), false);
      watch.dispose();
    });
  }
});

test('disposing while active-turn predicate is pending prevents a late match', async () => {
  const page = new EventEmitter();
  let completePredicate;
  const watch = watchQwenPunishNavigation(page, { isActive: () => new Promise(resolve => { completePredicate = resolve; }) });
  page.emit('request', request('https://chat.qwen.ai/api/v2/chat/completions/_____tmd_____/punish'));
  await new Promise(resolve => setImmediate(resolve));
  watch.dispose();
  completePredicate?.(true);
  assert.equal(await waitForMatch(watch.promise), false);
});
