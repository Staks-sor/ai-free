import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as taskRunner from '../src/window-app/task-runner.mjs';

for (const failing of ['abortAllTasks', 'closeBrowserSessions']) test(`shutdown still closes server after ${failing} fails`, async () => {
  const source = fs.readFileSync(new URL('../src/app-shutdown.mjs', import.meta.url), 'utf8');
  const calls = []; const context = vm.createContext({ shutdownPromise: null, state: {}, PHASES: { stopping_tasks: 'tasks', closing_browsers: 'browsers', closing_server: 'server', stopped: 'stopped' },
    logStep() {}, setPhase(phase) { context.state.phase = phase; }, sleep: async () => {},
    abortAllTasks: async () => { calls.push('abortAllTasks'); if (failing === 'abortAllTasks') throw Error('fixture abort'); },
    closeBrowserSessions: async () => { calls.push('closeBrowserSessions'); if (failing === 'closeBrowserSessions') throw Error('fixture browser'); },
    onServerClose(done) { calls.push('flush/server'); done(); } });
  vm.runInContext(source.slice(source.indexOf('export function requestAppShutdown')).replace('export function', 'function'), context);
  const first = context.requestAppShutdown(); assert.equal(context.requestAppShutdown(), first); await first;
  assert.deepEqual(calls, ['abortAllTasks', 'closeBrowserSessions', 'flush/server']);
  assert.equal(context.state.phase, 'stopped');
});

test('shutdown can await the actual settlement of cancelled tasks', async () => {
  let release; const id = 'shutdown-fixture';
  taskRunner.startTask(id, 'code', () => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve)); taskRunner.stopTask(id);
  try {
    assert.equal(typeof taskRunner.waitForAllTasks, 'function');
    const waiting = taskRunner.waitForAllTasks(); let settled = false; waiting.then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
    release(); assert.equal(await waiting, true); assert.equal(taskRunner.isRunning(id), false);
  } finally { release(); }
});

test('shutdown rejects new tasks before waiting for existing tasks', async () => {
  taskRunner.stopAllTasks({ shutdown: true });
  assert.throws(() => taskRunner.startTask('late-shutdown-task', 'code', async () => {}), error => error.code === 'APP_SHUTTING_DOWN');
});
