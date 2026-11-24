import test from 'node:test';
import assert from 'node:assert/strict';
import * as proxy from '../src/providers/qwen/browser-proxy.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('native challenge solving keeps the original submit pending and returns its replayed answer', async () => {
  assert.equal(typeof proxy.runQwenNativeTurnWithChallenge, 'function');
  const native = deferred(), challenge = deferred(), solving = deferred();
  let submits = 0, solves = 0;
  const result = proxy.runQwenNativeTurnWithChallenge({ submit: () => { submits++; return native.promise; },
    challenge: challenge.promise, solve: async () => { solves++; return solving.promise; } });
  challenge.resolve({ punish: true, status: 0 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(solves, 1);
  native.resolve({ ok: true, status: 200, text: 'original answer' });
  solving.resolve(true);
  assert.deepEqual(await result, { ok: true, status: 200, text: 'original answer' });
  assert.equal(submits, 1);
});

test('unsolved native challenge returns the actual challenge without a second submit', async () => {
  assert.equal(typeof proxy.runQwenNativeTurnWithChallenge, 'function');
  let submits = 0;
  const challenge = { punish: true, status: 0 };
  assert.deepEqual(await proxy.runQwenNativeTurnWithChallenge({ submit: () => { submits++; return new Promise(() => {}); },
    challenge: Promise.resolve(challenge), solve: async () => false }), challenge);
  assert.equal(submits, 1);
});

test('native success avoids solver and Stop during solving propagates', async () => {
  assert.equal(typeof proxy.runQwenNativeTurnWithChallenge, 'function');
  const reply = { ok: true, status: 200, text: 'answer' };
  assert.deepEqual(await proxy.runQwenNativeTurnWithChallenge({ submit: async () => reply,
    challenge: new Promise(() => {}), solve: () => assert.fail('no challenge') }), reply);
  const controller = new AbortController();
  await assert.rejects(proxy.runQwenNativeTurnWithChallenge({ submit: () => new Promise(() => {}),
    challenge: Promise.resolve({ punish: true, status: 0 }), signal: controller.signal,
    solve: async () => { controller.abort(); return true; } }), error => error.name === 'AbortError');
});
