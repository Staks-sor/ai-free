import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarnessScheduler } from '../src/harness/scheduler.mjs';

test('limits active workers, preserves FIFO and releases slots after failure', async () => {
  const scheduler = createHarnessScheduler({ concurrency: 2, maxQueued: 8 });
  let active = 0, maxActive = 0;
  const started = [];
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => scheduler.run(async () => {
    started.push(index); active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    if (index === 2) throw new Error('worker failed');
    return index;
  })));
  assert.equal(maxActive, 2);
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 7);
  assert.deepEqual(scheduler.snapshot(), { active: 0, queued: 0, concurrency: 2, maxQueued: 8 });
});

test('queued cancellation never starts a worker and queue overflow is bounded', async () => {
  const scheduler = createHarnessScheduler({ concurrency: 1, maxQueued: 1 });
  let release;
  const first = scheduler.run(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  const controller = new AbortController();
  const queued = scheduler.run(() => assert.fail('cancelled worker started'), { signal: controller.signal });
  await assert.rejects(scheduler.run(() => {}), error => error.code === 'HARNESS_QUEUE_FULL');
  controller.abort();
  await assert.rejects(queued, error => error.name === 'AbortError');
  release(); await first;
  assert.equal(scheduler.snapshot().queued, 0);
  assert.equal(scheduler.snapshot().active, 0);
});

test('provider pacing frees a worker and resumes through the same bounded queue', async () => {
  const { waitWithoutHarnessSlot } = await import('../src/harness/scheduler.mjs');
  const scheduler = createHarnessScheduler({concurrency:1,maxQueued:2});
  let release, entered;
  const ready=new Promise(r=>{entered=r;});
  const events=[];
  const first=scheduler.run(async()=>{events.push('first');await waitWithoutHarnessSlot(()=>new Promise(r=>{release=r;entered();}));events.push('resumed');});
  await ready;
  await scheduler.run(()=>{events.push('second');});
  assert.equal(scheduler.snapshot().active,0);
  release();await first;
  assert.deepEqual(events,['first','second','resumed']);
  assert.equal(scheduler.snapshot().active,0);
});

test('cancel during provider wait never reacquires or executes the request', async () => {
  const { waitWithoutHarnessSlot }=await import('../src/harness/scheduler.mjs');
  const {setTimeout:delay}=await import('node:timers/promises');
  const scheduler=createHarnessScheduler({concurrency:1});
  const controller=new AbortController();
  let entered;const ready=new Promise(r=>{entered=r;});
  const task=scheduler.run(async()=>{await waitWithoutHarnessSlot(()=>{entered();return delay(10000,undefined,{signal:controller.signal});});assert.fail('sent after stop');},{signal:controller.signal});
  await ready;controller.abort();await assert.rejects(task,e=>e.name==='AbortError');
  assert.equal(scheduler.snapshot().active,0);
  assert.equal(await scheduler.run(()=>42),42);
});

test('failed waits reacquire fairly and suspended work stays within queue capacity',async()=>{
  const {waitWithoutHarnessSlot}=await import('../src/harness/scheduler.mjs');
  const scheduler=createHarnessScheduler({concurrency:1,maxQueued:1});
  let wake,entered;const ready=new Promise(r=>{entered=r;});
  const task=scheduler.run(async()=>{
    await assert.rejects(waitWithoutHarnessSlot(()=>new Promise((_,reject)=>{wake=()=>reject(new Error('wait failed'));entered();})),/wait failed/);
    assert.equal(scheduler.snapshot().active,1);
  });
  await ready;
  await assert.rejects(scheduler.run(()=>assert.fail('overflow')),e=>e.code==='HARNESS_QUEUE_FULL');
  wake();await task;assert.equal(scheduler.snapshot().active,0);
});

test('stop while reacquiring a worker removes the resume ticket without releasing another worker',async()=>{
  const {waitWithoutHarnessSlot}=await import('../src/harness/scheduler.mjs');
  const scheduler=createHarnessScheduler({concurrency:1,maxQueued:2}),controller=new AbortController();
  let wake,readyWait,releaseOther,otherReady;
  const waiting=new Promise(r=>{readyWait=r;}),running=new Promise(r=>{otherReady=r;});
  const first=scheduler.run(async()=>{await waitWithoutHarnessSlot(()=>new Promise(r=>{wake=r;readyWait();}));assert.fail('resumed after stop');},{signal:controller.signal});
  await waiting;
  const other=scheduler.run(()=>new Promise(r=>{releaseOther=r;otherReady();}));await running;
  wake();await new Promise(r=>setImmediate(r));
  controller.abort();await assert.rejects(first,e=>e.name==='AbortError');
  assert.equal(scheduler.snapshot().active,1);assert.equal(scheduler.snapshot().queued,0);
  releaseOther();await other;assert.equal(scheduler.snapshot().active,0);
});
