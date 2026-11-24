import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRobokassaLink } from '../src/licensing/robokassa-link.mjs';
test('desktop receives only a SYNVOX Robokassa link for its installation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'synvox-robo-test-'));
  let foreign = false;
  try {
    const options = { identityPath: path.join(directory, 'identity.json'), fetchImpl: async (url, init) => {
      if (new URL(url).pathname.endsWith('/register')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', key: JSON.parse(init.body).key }));
      assert.match(init.headers.Authorization, /^Bearer /);
      return new Response(JSON.stringify({ url: foreign ? 'https://evil.invalid/' : 'https://synvox.pro/v1/license/robokassa/checkout?token=' + 'a'.repeat(32) }));
    } };
    assert.match((await createRobokassaLink(options)).url, /synvox.pro/);
    foreign = true;
    await assert.rejects(createRobokassaLink(options), /Некорректная/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
