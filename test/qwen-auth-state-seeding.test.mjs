import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { seedQwenPageToken } from '../src/providers/qwen/auth-files.mjs';

const now = Date.now();
const jwt = exp => `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;

function makePage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const context = vm.createContext({ localStorage, atob: value => Buffer.from(value, 'base64').toString('binary') });
  const call = token => vm.runInContext(`(${seedQwenPageToken.toString()})(${JSON.stringify(token)})`, context);
  return { call, values };
}

function stateOf(values) {
  const raw = values.get('qwen_access_token_state');
  return raw ? JSON.parse(raw) : null;
}

function assertValidNativeState(state, expectedToken) {
  assert.equal(state?.version, 1);
  assert.equal(typeof state.stateId, 'string');
  assert.ok(state.stateId.length > 0);
  assert.equal(state.token, expectedToken);
  assert.ok(Number.isFinite(state.expiresAt));
  assert.ok(Number.isFinite(state.updatedAt));
  assert.equal(typeof state.sourceId, 'string');
}

test('imported fresh auth replaces older raw and native token state with aligned expiry', () => {
  const oldToken = jwt(Math.floor(now / 1000) + 60);
  const imported = jwt(Math.floor(now / 1000) + 3600);
  const page = makePage({
    token: oldToken,
    at_expire_time: String((Math.floor(now / 1000) + 60) * 1000),
    qwen_access_token_state: JSON.stringify({ version: 1, stateId: 'old-state', token: oldToken,
      expiresAt: (Math.floor(now / 1000) + 60) * 1000, updatedAt: now - 1000, sourceId: 'old-source' }),
  });

  page.call(imported);

  assert.equal(page.values.get('token'), imported);
  assert.equal(Number(page.values.get('at_expire_time')), (Math.floor(now / 1000) + 3600) * 1000);
  assertValidNativeState(stateOf(page.values), imported);
});

test('an equal unexpired raw token without native state gets valid legacy and native expiry metadata', () => {
  const current = jwt(Math.floor(now / 1000) + 1800);
  const page = makePage({ token: current });

  page.call(current);

  assert.equal(page.values.get('token'), current);
  assert.equal(Number(page.values.get('at_expire_time')), (Math.floor(now / 1000) + 1800) * 1000);
  assertValidNativeState(stateOf(page.values), current);
});

test('a newer native token wins over raw and imported tokens and aligns the legacy token', () => {
  const old = jwt(Math.floor(now / 1000) + 600);
  const imported = jwt(Math.floor(now / 1000) + 1200);
  const native = jwt(Math.floor(now / 1000) + 2400);
  const page = makePage({
    token: old,
    at_expire_time: String((Math.floor(now / 1000) + 600) * 1000),
    qwen_access_token_state: JSON.stringify({ version: 1, stateId: 'newer-state', token: native,
      expiresAt: (Math.floor(now / 1000) + 2400) * 1000, updatedAt: now, sourceId: 'native-source' }),
  });

  page.call(imported);

  assert.equal(page.values.get('token'), native);
  assert.equal(Number(page.values.get('at_expire_time')), (Math.floor(now / 1000) + 2400) * 1000);
  assert.equal(stateOf(page.values).stateId, 'newer-state');
  assertValidNativeState(stateOf(page.values), native);
});

test('expired or invalid incoming tokens do not create apparently valid native state', () => {
  for (const token of [jwt(Math.floor(now / 1000) - 1), 'not-a-jwt']) {
    const page = makePage();
    page.call(token);
    const state = stateOf(page.values);
    assert.ok(!state || !Number.isFinite(state.expiresAt) || state.expiresAt <= now,
      'invalid input must not create a future-valid native token state');
  }
});
