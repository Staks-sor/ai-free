import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSessionPool } from '../src/browser/session-pool.mjs';
import { accountActivity, profileActivityId, withAccountActivitySession } from '../src/providers/activity-session.mjs';

function fakeFactory(log, key) {
  return async () => {
    log.push(`open:${key}`);
    return { call: async value => value, close: async () => log.push(`close:${key}`) };
  };
}

test('background browsers are bounded and cached facades reopen after eviction', async () => {
  const log = [], pool = createBrowserSessionPool({ limit: 2, idleMs: 10000 });
  const a = pool.proxy('a', () => fakeFactory(log, 'a')(), ['call']);
  const b = pool.proxy('b', fakeFactory(log, 'b'), ['call']);
  const c = pool.proxy('c', fakeFactory(log, 'c'), ['call']);
  assert.deepEqual(log, []);
  await a.call(1); await b.call(2); await c.call(3); await a.call(4);
  assert.deepEqual(log, ['open:a', 'open:b', 'close:a', 'open:c', 'close:b', 'open:a', 'close:c']);
  assert.equal(pool.snapshot().background, 1);
  await pool.closeAll();
});

test('busy sessions are never evicted and waiting work can be cancelled', async () => {
  const log = [], pool = createBrowserSessionPool({ limit: 2, idleMs: 10000 });
  const releases = [], started = [];
  const factory = key => async () => ({
    call: async () => { started.push(key); await new Promise(resolve => releases.push(resolve)); },
    close: async () => log.push(key),
  });
  const a = pool.proxy('a', factory('a'), ['call']), b = pool.proxy('b', factory('b'), ['call']);
  const c = pool.proxy('c', factory('c'), ['call']);
  const first = a.call({}), second = b.call({});
  while (started.length < 2) await new Promise(resolve => setImmediate(resolve));
  const controller = new AbortController(), third = c.call({ signal: controller.signal });
  controller.abort(); await assert.rejects(third, { name: 'AbortError' });
  assert.deepEqual(log, []); assert.equal(pool.snapshot().background, 2);
  releases.forEach(resolve => resolve()); await Promise.all([first, second]); await pool.closeAll();
});

test('idle cleanup closes sessions but visible challenge sessions stay pinned', async () => {
  const log = [], pool = createBrowserSessionPool({ limit: 1, idleMs: 15 });
  pool.pin('challenge', true);
  const challenge = pool.proxy('challenge', fakeFactory(log, 'challenge'), ['call']);
  await challenge.call();
  await pool.proxy('a', fakeFactory(log, 'a'), ['call']).call();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(log, ['open:challenge', 'open:a', 'close:a']);
  assert.equal(pool.snapshot().pinned, 1);
  pool.pin('challenge', false);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(log.includes('close:challenge')); await pool.closeAll();
});

test('failed launches free admission for subsequent attempts', async () => {
  const pool = createBrowserSessionPool({ limit: 1 });
  const proxy = pool.proxy('a', async () => { throw new Error('launch failed'); }, ['call']);
  await assert.rejects(proxy.call(), /launch failed/);
  assert.equal(pool.snapshot().background, 0);
  await pool.proxy('b', async () => ({ call: () => 7, close() {} }), ['call']).call();
  await pool.closeAll();
});

test('unpinning a visible session does not overflow the background budget', async () => {
  const log = [], pool = createBrowserSessionPool({ limit: 1, idleMs: 10000 });
  pool.pin('visible', true);
  await pool.proxy('visible', fakeFactory(log, 'visible'), ['call']).call();
  await pool.proxy('background', fakeFactory(log, 'background'), ['call']).call();
  await pool.pin('visible', false);
  assert.equal(pool.snapshot().background, 1);
  assert.ok(log.includes('close:visible'));
  await pool.closeAll();
});

test('only one idle background session stays warm after two concurrent tasks',async()=>{
 const log=[],pool=createBrowserSessionPool({limit:2,idleMs:10000});
 let releaseA,releaseB;
 const factory=key=>async()=>({call:()=>new Promise(r=>{if(key==='a')releaseA=r;else releaseB=r;}),close:async()=>log.push(key)});
 const a=pool.proxy('a',factory('a'),['call']),b=pool.proxy('b',factory('b'),['call']);
 const first=a.call(),second=b.call();
 while(!releaseA||!releaseB)await new Promise(r=>setImmediate(r));
 assert.equal(pool.snapshot().background,2);
 releaseA();await first;assert.deepEqual(log,[]);
 releaseB();await second;
 assert.equal(pool.snapshot().background,1);assert.deepEqual(log,['a']);
 await pool.closeAll();
});

test('idle reclamation failure does not discard a completed model response',async()=>{
 const failures=[],pool=createBrowserSessionPool({limit:2,onError:e=>failures.push(e.message)});let closes=0;
 await pool.proxy('a',async()=>({call:async()=>1,close:async()=>{if(++closes===1)throw new Error('close failed');}}),['call']).call();
 assert.equal(await pool.proxy('b',async()=>({call:async()=>2,close:async()=>{}}),['call']).call(),2);
 assert.deepEqual(failures,['close failed']);
 await pool.closeAll();
});

test('a failed idle close is retried by idle cleanup instead of retaining a browser forever',async()=>{
 const failures=[],pool=createBrowserSessionPool({limit:2,idleMs:10,onError:e=>failures.push(e.message)});let closes=0;
 await pool.proxy('a',async()=>({call:async()=>1,close:async()=>{if(++closes===1)throw new Error('temporary close failure');}}),['call']).call();
 await pool.proxy('b',async()=>({call:async()=>2,close:async()=>{}}),['call']).call();
 await new Promise(r=>setTimeout(r,60));
 assert.equal(pool.snapshot().background,0);assert.equal(closes,2);assert.deepEqual(failures,['temporary close failure']);
 await pool.closeAll();
});

test('provider browser lease stays busy between operations until successful close', async () => {
  const pool = createBrowserSessionPool({ limit: 1, idleMs: 10000 });
  let closeThis, closeArgs;
  const proxy = pool.proxy('qwen:lease-lifetime', async () => ({
    call: async value => value,
    close: async function (...args) { closeThis = this; closeArgs = args; },
  }), ['call']);
  assert.equal(await proxy.call('one'), 'one');
  assert.equal(accountActivity.isBusy('qwen', 'lease-lifetime'), true);
  assert.equal(await proxy.call('two'), 'two');
  assert.equal(accountActivity.isBusy('qwen', 'lease-lifetime'), true);
  await pool.closeAll();
  assert.equal(accountActivity.isBusy('qwen', 'lease-lifetime'), false);
  assert.ok(closeThis);
  assert.deepEqual(closeArgs, []);
});

test('failed close retains the provider lease until a retry succeeds', async () => {
  const failures = [];
  const pool = createBrowserSessionPool({ limit: 1, idleMs: 10000, onError: error => failures.push(error.message) });
  let closes = 0;
  await pool.proxy('glm:lease-close-failure', async () => ({
    call: async () => 'ok',
    close: async () => { if (++closes === 1) throw new Error('close failed'); },
  }), ['call']).call();
  assert.equal(accountActivity.isBusy('glm', 'lease-close-failure'), true);
  await assert.rejects(pool.closeAll(), /close failed/);
  assert.equal(accountActivity.isBusy('glm', 'lease-close-failure'), true);
  assert.deepEqual(failures, []);
  await pool.closeAll();
  assert.equal(accountActivity.isBusy('glm', 'lease-close-failure'), false);
});

test('provider browser factory failure releases its activity lease', async () => {
  const pool = createBrowserSessionPool({ limit: 1 });
  const proxy = pool.proxy('googleai:lease-factory-failure', async () => { throw new Error('launch failed'); }, ['call']);
  await assert.rejects(proxy.call(), /launch failed/);
  assert.equal(accountActivity.isBusy('googleai', 'lease-factory-failure'), false);
  await pool.proxy('googleai:lease-factory-failure', async () => ({ call: () => 7, close() {} }), ['call']).call();
  await pool.closeAll();
});

test('activity session helpers identify profiles without exposing their paths', async () => {
  const first = profileActivityId('/tmp/session-profile');
  const same = profileActivityId('/tmp/./session-profile');
  assert.equal(first, same);
  assert.match(first, /^profile_[a-f0-9]{64}$/);
  assert.doesNotMatch(first, /session-profile/);
});

test('activity session close wrapper preserves receiver and arguments', async () => {
  let receiver, received;
  const session = { close(...args) { receiver = this; received = args; return 'closed'; } };
  const wrapped = await withAccountActivitySession('chatgpt', 'wrapper-preservation', async () => session);
  assert.equal(wrapped.close.call(session, 'arg', 2), 'closed');
  assert.equal(receiver, session);
  assert.deepEqual(received, ['arg', 2]);
  assert.equal(accountActivity.isBusy('chatgpt', 'wrapper-preservation'), false);
});

test('activity session context close releases a session without a close method', async () => {
  let closed;
  await withAccountActivitySession('chatgpt', 'context-close', async () => ({
    context: { once(event, listener) { assert.equal(event, 'close'); closed = listener; } },
  }));
  assert.equal(accountActivity.isBusy('chatgpt', 'context-close'), true);
  closed();
  assert.equal(accountActivity.isBusy('chatgpt', 'context-close'), false);
});

test('activity session factory returning no session releases its lease', async () => {
  assert.equal(await withAccountActivitySession('chatgpt', 'null-session', async () => null), null);
  assert.equal(accountActivity.isBusy('chatgpt', 'null-session'), false);
  assert.equal(await withAccountActivitySession('chatgpt', 'undefined-session', async () => undefined), undefined);
  assert.equal(accountActivity.isBusy('chatgpt', 'undefined-session'), false);
});
