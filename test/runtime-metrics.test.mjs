import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeMetrics, runtimeMetrics, measureModelTurn, measureMemoryRetrieval } from '../src/diagnostics/runtime-metrics.mjs';

test('bounded metrics retain recent percentiles and reject arbitrary labels or payloads', () => {
  const metrics = createRuntimeMetrics();
  for (let i = 1; i <= 300; i++) metrics.record('model_ms', i);
  metrics.record('secret prompt', 1); metrics.record('model_ms', { secret:'token' });
  metrics.record('model_ms', NaN); metrics.record('model_ms', -1);
  const snapshot = metrics.snapshot();
  assert.deepEqual(Object.keys(snapshot), ['model_ms']);
  assert.equal(snapshot.model_ms.count, 300);
  assert.equal(snapshot.model_ms.samples, 128);
  assert.equal(snapshot.model_ms.p50, 236);
  assert.equal(snapshot.model_ms.p95, 294);
  snapshot.model_ms.count = 0;
  assert.equal(metrics.snapshot().model_ms.count, 300);
});

test('model measurement calls once, preserves identity/result/errors and retains no request data', async () => {
  const value = { text:'private answer' }, request = { prompt:'secret prompt' }; let calls = 0;
  const client = { complete(arg) { assert.equal(this, client); assert.equal(arg, request); calls++; return value; } };
  const before = runtimeMetrics.snapshot().model_ms?.count || 0;
  assert.equal(await measureModelTurn(client, request), value); assert.equal(calls, 1);
  const error = new Error('secret error'); client.complete = () => { throw error; };
  await assert.rejects(measureModelTurn(client, request), e => e === error);
  const snapshot = runtimeMetrics.snapshot();
  assert.equal(snapshot.model_ms.count, before + 2);
  assert.equal(snapshot.model_failed.count >= 1, true);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|private/);
});

test('retrieval measurement records CPU, duration and UTF-8 bytes without retaining context', () => {
  const result = { context:'память', usedCount:1 };
  assert.equal(measureMemoryRetrieval(() => result), result);
  assert.equal(runtimeMetrics.snapshot().rag_bytes.max, Buffer.byteLength(result.context));
  assert.equal(runtimeMetrics.snapshot().rag_cpu_ms.count >= 1, true);
  const error = new Error('retrieval error');
  assert.throws(() => measureMemoryRetrieval(() => { throw error; }), e => e === error);
  assert.equal(runtimeMetrics.snapshot().rag_failed.count, 1);
});

test('scheduler measures queue residence separately from work and cancellation', async () => {
  const { createHarnessScheduler } = await import('../src/harness/scheduler.mjs');
  let now = 0, release;
  const scheduler = createHarnessScheduler({ concurrency:1, now:() => now });
  const before = runtimeMetrics.snapshot().queue_ms?.count || 0;
  const first = scheduler.run(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  const second = scheduler.run(() => 'second');
  const controller = new AbortController();
  const cancelled = scheduler.run(() => assert.fail('cancelled work ran'), { signal:controller.signal });
  now = 10; controller.abort(); await assert.rejects(cancelled, /cancelled/);
  now = 20; release(); await first; assert.equal(await second, 'second');
  assert.equal(runtimeMetrics.snapshot().queue_ms.count, before+2);
  assert.equal(runtimeMetrics.snapshot().queue_ms.max, 20);
  assert.equal(runtimeMetrics.snapshot().queue_cancelled_ms.max, 10);
});
