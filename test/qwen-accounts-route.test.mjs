import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleAccountRequest } from '../src/window-app/account-routes.mjs';

test('desktop accounts route permits same-origin JSON only and never executes a foreign mutation', async () => {
  const source = fs.readFileSync(new URL('../src/window-app/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /await handleAccountRequest\(req, res, url/);
  let mutations = 0;
  const handler = async req => {
    let response;
    await handleAccountRequest(req, {}, { pathname: '/api/accounts/qwen' }, {
      sendJson: (_, data, status = 200) => { response = { status, data }; },
      readBody: async () => ({ action: 'autoSwitch', enabled: false }),
      qwen: { snapshot: async () => ({ accounts: [] }), action: async () => { mutations++; return {}; } },
      web: { isLoggingIn: () => false },
    });
    return response;
  };
  for (const origin of [undefined, 'null', 'https://evil.example']) {
    assert.equal((await handler({ method:'POST',headers:{host:'127.0.0.1:4317',origin,'content-type':'application/json'} })).status,403);
  }
  assert.equal(mutations,0);
  assert.equal((await handler({method:'POST',headers:{host:'127.0.0.1:4317',origin:'http://127.0.0.1:4317','content-type':'application/json'}})).status,200);
  assert.equal(mutations,1);
  assert.equal((await handler({method:'GET',headers:{host:'evil.example'}})).status,403);
  assert.equal((await handler({method:'GET',headers:{host:'127.0.0.1:4317'}})).status,200);
});
