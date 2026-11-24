import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
test('plugins keep free runtime and stable marketplace identities', () => {
  const version = JSON.parse(read('package.json')).version;
  for (const p of ['package-lock.json','plugin-for-vscode/package.json','plugin-for-vscode/package-lock.json']) assert.equal(JSON.parse(read(p)).version, version, p);
  assert.match(read('plugin-for-jetbrains/gradle.properties'), new RegExp(`^version=${version.replaceAll('.', '\\.')}$`, 'm'));
  assert.equal(JSON.parse(read('package.json')).engines.node, '>=22');
  assert.doesNotMatch(read('plugin-for-vscode/extension.js'),/SYNVOX_LICENSE_ENFORCE/);
  assert.doesNotMatch(read('plugin-for-jetbrains/src/main/kotlin/ru/stassor/aifree/runtime/AiFreeBackendService.kt'),/SYNVOX_LICENSE_ENFORCE/);
  for (const prefix of ['', 'plugin-for-vscode/']) {
    assert.match(read(prefix+'src/licensing/merchant-public.pem'),/BEGIN PUBLIC KEY/);
    const server = read(prefix+'src/window-app/server.mjs');
    assert.match(server,/requiresDesktopLicense\(req.method/);
    assert.match(server,/\/api\/subscription\/robokassa/);
    assert.match(server,/await handleAccountRequest\(req, res, url/);
    assert.match(read(prefix+'src/window-app/account-routes.mjs'),/'qwen'/);
    assert.match(server,/IDE plugins must be updated through their marketplace/);
  }
  assert.equal(JSON.parse(read('plugin-for-vscode/package.json')).name,'ai-free-vscode');
});
