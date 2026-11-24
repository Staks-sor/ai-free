import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createBrowserSessionPool } from '../src/browser/session-pool.mjs';

test('shutdown closes pooled sessions belonging to additional accounts', async () => {
  const source = readFileSync(new URL('../src/app-shutdown.mjs', import.meta.url), 'utf8');
  assert.match(source, /await backgroundBrowserPool\.closeAll\(\)/);
  const closed = [];
  const pool = createBrowserSessionPool({ limit: 2, idleMs: 60000 });
  for (const key of ['chatgpt:account2', 'glm:account3']) {
    const proxy = pool.proxy(key, async () => ({ sendChat: async () => 'ok', close: async () => closed.push(key) }), ['sendChat']);
    await proxy.sendChat();
  }
  await pool.closeAll();
  assert.deepEqual(closed.sort(), ['chatgpt:account2', 'glm:account3']);
});
