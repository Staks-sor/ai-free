import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkForUpdate, runUpdate } from '../src/desktop-transition.mjs';
import { installWebsiteBundle } from '../src/website-update-install.mjs';

const keys = generateKeyPairSync('ed25519');
const pkg = (version) => ({ name: 'ai-free', version, dependencies: {} });
function fixture(files = { 'package.json': JSON.stringify(pkg('0.5.0')), 'src/config.mjs': '// config', 'bin/deepseek.mjs': '// entry', 'api/models.mjs': '// api', 'packages/core/package.json': '{"name":"@synvox/core"}' }) {
  const bundle = gzipSync(JSON.stringify({ files: Object.entries(files).map(([name, data]) => ({ path: name, data: Buffer.from(data).toString('base64') })) }));
  const payload = Buffer.from(JSON.stringify({ version: '0.5.0', platforms: ['darwin', 'win32', 'linux'], url: 'https://synvox.pro/desktop/releases/0.5.0.json.gz', sha256: createHash('sha256').update(bundle).digest('hex') }));
  const manifest = { schemaVersion: 1, status: 'ready', payload: payload.toString('base64'), signature: sign(null, payload, keys.privateKey).toString('base64') };
  const options = { currentVersion: '0.4.25', platform: 'darwin', publicKey: keys.publicKey, fetchImpl: async (url) => new Response(url.endsWith('.json.gz') ? bundle : JSON.stringify(manifest)) };
  return { manifest, bundle, options };
}

test('website offers signed automatic installation', async () => {
  const data = fixture();
  const original = data.options.fetchImpl;
  data.options.fetchImpl = async (url, config) => {
    assert.equal(url, 'https://synvox.pro/desktop/update.json');
    assert.equal(config.redirect, 'error');
    assert.ok(config.signal);
    return original(url);
  };
  const result = await checkForUpdate(data.options);
  assert.equal(result.updateAvailable, true);
  assert.equal(result.canUpdate, true);
  assert.equal(result.updateMethod, 'website');
});

test('pending, unsupported, current and offline do not offer installation', async () => {
  const data = fixture();
  for (const opts of [
    { ...data.options, fetchImpl: async () => new Response('{"schemaVersion":1,"status":"pending"}') },
    { ...data.options, platform: 'freebsd' },
    { ...data.options, currentVersion: '0.5.0' },
    { ...data.options, fetchImpl: async () => { throw new Error('offline'); } },
  ]) assert.equal((await checkForUpdate(opts)).updateAvailable, false);
});

test('rejects a tampered release', async () => {
  const data = fixture();
  data.manifest.payload = Buffer.from('{}').toString('base64');
  const result = await checkForUpdate(data.options);
  assert.equal(result.ok, false);
  assert.equal(result.canUpdate, false);
});

async function installation(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'synvox-update-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src/old.mjs'), 'old');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg('0.4.25')));
  await fs.writeFile(path.join(root, '.env'), 'USER_DATA=preserved');
  await fs.mkdir(path.join(root, '.git'));
  return root;
}

test('installs website release, backs up code and preserves user files', async (t) => {
  const root = await installation(t);
  const result = await runUpdate({ ...fixture().options, root });
  assert.equal(result.updated, true);
  assert.equal(result.restartReady, true);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version, '0.5.0');
  assert.equal(await fs.readFile(path.join(root, '.env'), 'utf8'), 'USER_DATA=preserved');
  assert.equal(await fs.readFile(path.join(result.backupPath, 'src/old.mjs'), 'utf8'), 'old');
  await fs.access(path.join(root, '.git'));
});

test('corrupt bundles and traversal cannot change the installation', async (t) => {
  const root = await installation(t);
  await assert.rejects(runUpdate({ ...fixture({ '../escape': 'bad' }).options, root }));
  const corrupt = fixture();
  const original = corrupt.options.fetchImpl;
  corrupt.options.fetchImpl = async (url) => url.endsWith('.json.gz') ? new Response('corrupt') : original(url);
  await assert.rejects(runUpdate({ ...corrupt.options, root }), /контрольная сумма/);
  assert.equal(await fs.readFile(path.join(root, 'src/old.mjs'), 'utf8'), 'old');
});

test('a mid-install rename failure restores the old program', async (t) => {
  const root = await installation(t);
  let moves = 0;
  await assert.rejects(runUpdate({ ...fixture().options, root, move: async (...args) => {
    if (++moves === 4) throw new Error('simulated filesystem failure');
    return fs.rename(...args);
  } }), /simulated/);
  assert.equal(await fs.readFile(path.join(root, 'src/old.mjs'), 'utf8'), 'old');
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version, '0.4.25');
});

test('dependency preparation failure does not replace the installed files', async (t) => {
  const root = await installation(t);
  const next = fixture();
  const { gunzipSync } = await import('node:zlib');
  const bundle = JSON.parse(gunzipSync(next.bundle));
  bundle.files.find((file) => file.path === 'package.json').data = Buffer.from(JSON.stringify({ ...pkg('0.5.0'), dependencies: { example: '1.0.0' } })).toString('base64');
  await assert.rejects(installWebsiteBundle(root, bundle, '0.5.0', { prepareDependencies: async () => { throw new Error('npm unavailable'); } }), /npm unavailable/);
  assert.equal(await fs.readFile(path.join(root, 'src/old.mjs'), 'utf8'), 'old');
});

test('plugins keep their existing updater and the website starts pending', async () => {
  const server = await fs.readFile(new URL('../plugin-for-vscode/src/window-app/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /AI_FREE_VSCODE === "1"[\s\S]{0,180}IDE plugins must be updated through their marketplace/);
  const manifest = JSON.parse(await fs.readFile(new URL('../website/static/desktop/update.json', import.meta.url)));
  assert.equal(manifest.status, 'pending');
});

test('publisher creates a release that the desktop can verify and refuses dirty source', async (t) => {
  const root = await installation(t);
  const source = path.join(root, 'release-source');
  await fs.mkdir(source);
  const data = fixture();
  const { gunzipSync } = await import('node:zlib');
  for (const file of JSON.parse(gunzipSync(data.bundle)).files) {
    await fs.mkdir(path.dirname(path.join(source, file.path)), { recursive: true });
    await fs.writeFile(path.join(source, file.path), Buffer.from(file.data, 'base64'));
  }
  await fs.writeFile(path.join(source, 'src/desktop-transition.mjs'), '// pinned key\n' + keys.publicKey.export({ type: 'spki', format: 'pem' }));
  const keyFile = path.join(root, 'test-key.pem');
  await fs.writeFile(keyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  execFileSync('git', ['init', '-q'], { cwd: source });
  execFileSync('git', ['add', '.'], { cwd: source });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'], { cwd: source });
  const builder = fileURLToPath(new URL('../scripts/build-desktop-update.mjs', import.meta.url));
  const output = path.join(root, 'built');
  execFileSync(process.execPath, [builder, source, output, keyFile]);
  const built = await fs.readFile(path.join(output, 'update.json'));
  const check = await checkForUpdate({ ...data.options, fetchImpl: async () => new Response(built) });
  assert.equal(check.updateAvailable, true);
  const installed = await runUpdate({ ...data.options, root, fetchImpl: async (url) => new Response(url.endsWith('.json.gz') ? await fs.readFile(path.join(output, 'releases/0.5.0.json.gz')) : built) });
  assert.equal(installed.updated, true);
  await fs.writeFile(path.join(source, 'src/unfinished.mjs'), 'unfinished');
  assert.throws(() => execFileSync(process.execPath, [builder, source, path.join(root, 'dirty-output'), keyFile], { stdio: 'pipe' }), /clean/);
});

test('another running update prevents writes', async (t) => {
  const root = await installation(t);
  await fs.writeFile(path.join(root, '.synvox-update.lock'), '');
  await assert.rejects(runUpdate({ ...fixture().options, root }), /уже выполняется/);
  await fs.access(path.join(root, '.synvox-update.lock'));
  assert.equal(await fs.readFile(path.join(root, 'src/old.mjs'), 'utf8'), 'old');
});

test('even signed download URLs must remain on the official release path', async () => {
  const data = fixture();
  const payload = JSON.parse(Buffer.from(data.manifest.payload, 'base64'));
  payload.url = 'https://github.com/example/release.json.gz';
  const bytes = Buffer.from(JSON.stringify(payload));
  data.manifest.payload = bytes.toString('base64');
  data.manifest.signature = sign(null, bytes, keys.privateKey).toString('base64');
  const result = await checkForUpdate(data.options);
  assert.equal(result.ok, false);
  assert.equal(result.canUpdate, false);
});

test('desktop update button uses the install endpoint, not a manual website handoff', async () => {
  const { renderWindowHtml } = await import('../src/window-app/ui-html.mjs');
  const html = renderWindowHtml({ language: 'ru' });
  const action = html.slice(html.indexOf('async function installAvailableUpdate'), html.indexOf('function updateStreamingAssistantBubble'));
  assert.match(action, /api\("\/api\/update\/run"/);
  assert.doesNotMatch(action, /window\.open|migration/);
  assert.match(html, /Источник обновлений/);
});
