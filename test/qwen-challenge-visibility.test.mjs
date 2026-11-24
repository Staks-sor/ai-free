import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/providers/qwen/browser-proxy.mjs', import.meta.url), 'utf8');

function visibilityPredicate() {
  const exported = source.match(/export function isQwenChallengeVisible\s*\([^)]*\)\s*\{[\s\S]*?\n\}/)?.[0];
  if (exported) return exported.replace(/^export\s+/, '').replace(/^function\s+isQwenChallengeVisible/, 'function predicate');
  const inline = source.match(/const isChallengeVisible = \(\) => \(([\s\S]*?)\);/);
  assert.ok(inline, 'expected the current showCaptchaWindow challenge predicate');
  return `function predicate(){ return (${inline[1]}); }`;
}

function challengeVisible({ pathname = '/', target = null, ancestors = [] } = {}) {
  const predicate = visibilityPredicate();
  const challengeTarget = target;
  const document = {
    querySelector: () => challengeTarget,
    querySelectorAll: () => challengeTarget ? [challengeTarget] : [],
  };
  const context = vm.createContext({ document, location: { pathname },
    getComputedStyle: element => element.computedStyle || element.style || {},
    window: { innerWidth: 1280, innerHeight: 800,
      getComputedStyle: element => element.computedStyle || element.style || {} },
  });
  for (const ancestor of ancestors) {
    if (target) { target.parentElement = ancestor; target = ancestor; }
  }
  return Boolean(vm.runInContext(`${predicate}\npredicate()`, context));
}

function element({ display = 'block', visibility = 'visible', opacity = '1', rect = { x: 100, y: 100, width: 500, height: 300 } } = {}) {
  return { style: { display, visibility, opacity }, getBoundingClientRect: () => rect };
}

test('ordinary Qwen page without challenge targets is not reported as challenged', () => {
  assert.equal(challengeVisible(), false);
});

test('visible challenge dialog and challenge iframe are detected', () => {
  assert.equal(challengeVisible({ target: element() }), true);
});

test('hidden challenge targets are not reported as visible', async t => {
  for (const [label, options] of [
    ['display none', { display: 'none' }],
    ['visibility hidden', { visibility: 'hidden' }],
    ['opacity zero', { opacity: '0' }],
  ]) {
    await t.test(label, () => assert.equal(challengeVisible({ target: element(options) }), false));
  }
});

test('a challenge target under a hidden ancestor is not visible', () => {
  assert.equal(challengeVisible({ target: element(), ancestors: [element({ display: 'none' })] }), false);
});

test('an offscreen or zero-size challenge iframe is not visible', async t => {
  for (const [label, rect] of [
    ['offscreen', { x: -10000, y: 0, width: 500, height: 300 }],
    ['offscreen right', { x: 1280, y: 100, width: 500, height: 300 }],
    ['offscreen bottom', { x: 100, y: 800, width: 500, height: 300 }],
    ['zero size', { x: 100, y: 100, width: 0, height: 0 }],
  ]) {
    await t.test(label, () => assert.equal(challengeVisible({ target: element({ rect }) }), false));
  }
});

test('the top-level Qwen punish route is still reported as challenged', () => {
  assert.equal(challengeVisible({ pathname: '/_____tmd_____/punish' }), true);
});
