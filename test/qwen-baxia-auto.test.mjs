import assert from 'node:assert/strict';
import test from 'node:test';
import * as baxiaSolver from '../src/providers/qwen/baxia-solver.mjs';
import {
  attemptBaxiaSolveFailOpen,
  dragBaxiaSlider,
  findBaxiaSlider,
  hasX5SecCookie,
  resolveBaxiaSolverConfig,
} from '../src/providers/qwen/baxia-solver.mjs';

test('automatic CAPTCHA solving is enabled by default but can be explicitly disabled', () => {
  assert.equal(resolveBaxiaSolverConfig({}).enabled, true);
  assert.equal(resolveBaxiaSolverConfig({ QWEN_BAXIA_AUTO_SOLVE: '0' }).enabled, false);
});

test('slider discovery selects the observed visible button handle, not the track', async () => {
  const handle = { id: 'nc_1_n1z', className: 'nc_iconfont btn_slide', boundingBox: async () => ({ x: 1, y: 1, width: 42, height: 30 }) };
  const track = { id: 'nc_1__scale_text', boundingBox: async () => ({ x: 1, y: 1, width: 300, height: 30 }) };
  const selectors = [];
  const page = { frames: () => [{
    async $(selector) {
      selectors.push(selector);
      if (selector === 'span#nc_1_n1z') return handle;
      if (selector === '#nc_1__scale_text') return track;
      return null;
    },
  }] };
  assert.equal(await findBaxiaSlider(page), handle);
  assert.equal(selectors[0], 'span#nc_1_n1z');
});

test('drag ends at the measured handle-to-track target', async () => {
  const moves = [];
  const events = [];
  const handle = {
    async boundingBox() { return { x: 40, y: 20, width: 42, height: 30 }; },
    async evaluate() { return { distance: 258 }; },
  };
  const page = {
    mouse: {
      async move(x, y) { moves.push({ x, y }); },
      async down() { events.push('down'); },
      async up() { events.push('up'); },
    },
    async waitForTimeout() {},
  };
  assert.equal(await dragBaxiaSlider(page, handle, { rng: () => 0 }), true);
  assert.equal(moves[0].x, 61);
  assert.equal(moves.at(-1).x, 319);
  assert.deepEqual(events, ['down', 'up']);
});

test('drag releases the mouse if Stop aborts its movement', async () => {
  const events = [];
  let waits = 0;
  const handle = {
    async boundingBox() { return { x: 40, y: 20, width: 42, height: 30 }; },
    async evaluate() { return { distance: 258 }; },
  };
  const page = {
    mouse: {
      async move() {},
      async down() { events.push('down'); },
      async up() { events.push('up'); },
    },
    async waitForTimeout() {
      waits++;
      if (waits === 2) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
    },
  };
  await assert.rejects(dragBaxiaSlider(page, handle, { rng: () => 0 }), error => error.name === 'AbortError');
  assert.deepEqual(events, ['down', 'up']);
});

test('disabled automatic solver does not invoke the solver callback', async () => {
  let solves = 0;
  const solved = await attemptBaxiaSolveFailOpen({ enabled: false,
    solve: async () => { solves++; return { solved: true }; }, clearCooldown: () => assert.fail('must not clear cooldown') });
  assert.equal(solved, false);
  assert.equal(solves, 0);
});

test('expired x5sec does not confirm a completed CAPTCHA solve', () => {
  const expired = Math.floor(Date.now() / 1000) - 1;
  assert.equal(hasX5SecCookie([{ name: 'x5sec', value: 'expired-token', expires: expired }]), false);
  assert.equal(hasX5SecCookie([{ name: 'x5sec', value: 'session-token' }]), true);
});

test('Stop before solving propagates AbortError without probing or dragging', async () => {
  const controller = new AbortController();
  controller.abort();
  let solves = 0;
  await assert.rejects(attemptBaxiaSolveFailOpen({ enabled: true, signal: controller.signal,
    solve: async () => { solves++; return { solved: true }; }, clearCooldown: () => assert.fail('must not clear cooldown') }),
  error => error.name === 'AbortError');
  assert.equal(solves, 0);
});

test('a visible Baxia error panel is reset before the next slider attempt', async () => {
  const resetBaxiaSlider = baxiaSolver.resetBaxiaSlider;
  assert.equal(typeof resetBaxiaSlider, 'function');
  const clicks = [];
  const retry = { async boundingBox() { return { x: 10, y: 10, width: 150, height: 36 }; },
    async click(options) { clicks.push(options); } };
  const selectors = [];
  const page = { frames: () => [{ async $(selector) { selectors.push(selector); return selector === '.nc-container .errloading' ? retry : null; } }] };
  assert.equal(await resetBaxiaSlider(page), true);
  assert.deepEqual(selectors, ['.nc-container .errloading']);
  assert.deepEqual(clicks, [{ timeout: 3000 }]);
});

test('hidden Baxia error panel is not clicked', async () => {
  const resetBaxiaSlider = baxiaSolver.resetBaxiaSlider;
  assert.equal(typeof resetBaxiaSlider, 'function');
  let clicks = 0;
  const hidden = { async boundingBox() { return null; }, async click() { clicks++; } };
  const page = { frames: () => [{ async $() { return hidden; } }] };
  assert.equal(await resetBaxiaSlider(page), false);
  assert.equal(clicks, 0);
});

test('Stop before Baxia reset performs no frame lookup or click', async () => {
  const resetBaxiaSlider = baxiaSolver.resetBaxiaSlider;
  assert.equal(typeof resetBaxiaSlider, 'function');
  const controller = new AbortController();
  controller.abort();
  const page = { frames: () => assert.fail('must not inspect frames after Stop') };
  await assert.rejects(resetBaxiaSlider(page, { signal: controller.signal }), error => error.name === 'AbortError');
});
