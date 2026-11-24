import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

for (const entry of ['bin/deepseek.mjs', 'plugin-for-vscode/bin/deepseek.mjs']) {
  test(`${entry}: Camoufox login starts without checking or installing Chromium`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-browser-bootstrap-'));
    const write = (file, text) => {
      const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text);
    };
    try {
      write('bin/deepseek.mjs', fs.readFileSync(new URL(`../${entry}`, import.meta.url), 'utf8'));
      write('node_modules/playwright/package.json', '{}');
      write('src/config.mjs', "export const AI_FREE_VERSION = '0.5.3';");
      write('src/args.mjs', 'export function loadDotEnv() {}');
      write('src/logging/logger.mjs', 'export function createFileLogger() { return { error() {} }; } export function installProcessErrorLogging() {}');
      write('src/browser/ensure-binaries.mjs', "export function ensureBrowserBinaries() { throw new Error('Unexpected Chromium installation'); }");
      write('src/cli/run.mjs', "export async function run() { console.log('CLI_READY ' + process.argv.slice(2).join(' ')); }");
      const result = spawnSync(process.execPath, [path.join(root, 'bin/deepseek.mjs'), '--login-qwen'],
        { cwd: root, env: { ...process.env, HOME: root, AI_FREE_BROWSER_ENGINE: 'camoufox' }, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /CLI_READY --login-qwen/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

test('npm installation does not download both Chromium runtimes for Camoufox users', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.scripts.postinstall, undefined);
});


test('real desktop CLI help works with an empty browser cache and no installer in PATH', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-help-no-chromium-'));
  try {
    const result = spawnSync(process.execPath, [new URL('../bin/deepseek.mjs', import.meta.url).pathname, '--help'],
      { cwd: root, env: { ...process.env, HOME: root, PATH: root, PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'empty-cache'),
        AI_FREE_LOG_DIR: path.join(root, 'logs') }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--login-qwen/);
    assert.doesNotMatch(result.stdout, /Ставлю Chromium|Chromium not installed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
