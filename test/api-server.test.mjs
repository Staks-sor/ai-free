import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('API refuses requests when no provider key is configured', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-api-empty-'));
  const serverUrl = new URL('../api/server.mjs', import.meta.url).href;
  try {
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      const { createOpenAICompatServer } = await import(${JSON.stringify(serverUrl)});
      const server = createOpenAICompatServer();
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/v1/models');
        assert.equal(response.status, 401);
      } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    `], { cwd: root, env: { ...process.env, HOME: root, AI_FREE_LOG_DIR: path.join(root, 'logs') }, timeout: 15000 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Isolate HOME before imports so this check never changes a user's API keys.
test('API rejects missing/wrong keys, supports CORS preflight and uses only its logger', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-api-test-'));
  const settingsUrl = new URL('../src/state/settings.mjs', import.meta.url).href;
  const serverUrl = new URL('../api/server.mjs', import.meta.url).href;
  try {
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      const { saveSettings, loadSettings } = await import(${JSON.stringify(settingsUrl)});
      saveSettings({ ...loadSettings(), openAICompat: { apiKeys: { deepseek: 'test-only-key' } } });
      const { createOpenAICompatServer } = await import(${JSON.stringify(serverUrl)});
      let consoleCalls = 0; console.log = () => { consoleCalls++; };
      const server = createOpenAICompatServer();
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const url = 'http://127.0.0.1:' + server.address().port + '/v1/models';
      try {
        for (const headers of [{}, { Authorization: 'Bearer wrong' }]) {
          const response = await fetch(url, { headers });
          assert.equal(response.status, 401);
          assert.equal(response.headers.get('access-control-allow-origin'), null);
          assert.equal((await response.json()).error.type, 'authentication_error');
        }
        const response = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'http://localhost:1234' } });
        assert.equal(response.status, 204);
        assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:1234');
        assert.equal(await response.text(), '');
        assert.match(response.headers.get('access-control-allow-methods'), /POST/);
        assert.match(response.headers.get('access-control-allow-headers'), /Authorization/);
        const foreign = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://attacker.example' } });
        assert.equal(foreign.status, 403);
        assert.equal(foreign.headers.get('access-control-allow-origin'), null);
        assert.equal(consoleCalls, 0);
      } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    `], { cwd: root, env: { ...process.env, HOME: root, AI_FREE_LOG_LEVEL: 'error', AI_FREE_LOG_DIR: path.join(root, 'logs') }, timeout: 15000 });
    assert.equal(result.stderr, '');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
