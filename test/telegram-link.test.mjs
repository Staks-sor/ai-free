import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTelegramLink } from '../src/licensing/telegram-link.mjs';
test('desktop receives a short link, never exposes key, rejects a foreign payment URL', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-link-'));
  let foreign = false;
  const fetchImpl = async (url, options) => ({ ok: true, json: async () => String(url).endsWith('/register')
    ? { id: randomUUID(), key: JSON.parse(options.body).key }
    : { url: foreign ? 'https://evil.invalid' : 'https://t.me/Synvox_bot?start=' + 'a'.repeat(32) } });
  try {
    const result = await createTelegramLink({ identityPath: path.join(dir, 'key.json'), fetchImpl });
    assert.ok(!('key' in result));
    foreign = true;
    await assert.rejects(createTelegramLink({ identityPath: path.join(dir, 'key.json'), fetchImpl }), /ссылка/);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
