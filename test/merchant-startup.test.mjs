import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createLicenseService } from '../services/licensing/service.mjs';

test('existing licenses remain available while Telegram is offline', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-merchant-offline-'));
  const pair = generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(directory, 'private.pem'), pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const tokenFile = path.join(directory, 'bot-token');
  fs.writeFileSync(tokenFile, '123:test-token');
  const database = path.join(directory, 'licenses.sqlite');
  const service = createLicenseService({ database, privateKey: pair.privateKey, mode: 'stars' });
  const key = randomBytes(32).toString('base64url');
  const identity = service.register(key);
  const expiry = service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(identity.id).access_until;
  service.close();
  const child = spawn(process.execPath, ['--import', new URL('./fixtures/telegram-offline.mjs', import.meta.url).pathname, new URL('../services/licensing/merchant-run.mjs', import.meta.url).pathname], {
    env: { ...process.env, SYNVOX_DATA_DIR: directory, SYNVOX_BOT_TOKEN_FILE: tokenFile, SYNVOX_ROBOKASSA_CONFIG_FILE: '', SYNVOX_YOOKASSA_CONFIG_FILE: '' },
    stdio: 'ignore',
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 40 && child.exitCode === null; attempt++) {
      try { healthy = (await fetch('http://127.0.0.1:4329/v1/license/health')).status === 200; } catch {}
      if (healthy) break;
      await delay(50);
    }
    assert.equal(healthy, true, 'license HTTP API must start without Telegram');
    const response = await fetch('http://127.0.0.1:4329/v1/license/status', { headers: { Authorization: 'Bearer ' + key } });
    assert.equal(response.status, 200);
    const verify = createLicenseService({ database, privateKey: pair.privateKey, mode: 'stars' });
    try {
      assert.equal(verify.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(identity.id).access_until, expiry);
      assert.equal(verify.db.prepare('SELECT COUNT(*) n FROM licenses').get().n, 1);
    } finally { verify.close(); }
    assert.equal(child.exitCode, null);
  } finally {
    child.kill('SIGTERM');
    await exited;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
