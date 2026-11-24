import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const source = new URL('../src/providers/qwen/browser-proxy.mjs', import.meta.url).href;

async function selectedProfile({ accountId, accounts }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-profile-selection-'));
  const isolateHome = path.join(home, 'isolate-home.mjs');
  fs.writeFileSync(isolateHome, `import os from 'node:os'; import { syncBuiltinESMExports } from 'node:module'; os.homedir = () => process.env.SYNVOX_TEST_RUNTIME_ROOT; syncBuiltinESMExports();`);
  const env = { ...process.env, NODE_TEST_CONTEXT: '1',
    SYNVOX_TEST_USER_HOME: os.homedir(), SYNVOX_TEST_RUNTIME_ROOT: home };
  delete env.NODE_OPTIONS;
  const script = `
    import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
    const source = ${JSON.stringify(source)};
    globalThis.__accounts = ${JSON.stringify(accounts)};
    const launchStub = 'data:text/javascript,' + encodeURIComponent(
      'export async function launchQwenCamoufoxSession(profileDir) { globalThis.__selectedProfile = profileDir; throw new Error("STOP_BEFORE_BROWSER"); }'
    );
    const accountStub = 'data:text/javascript,' + encodeURIComponent(
      'export function getAccountById() { return null; } export function loadAccounts() { return globalThis.__accounts; }'
    );
    let code = fs.readFileSync(new URL(source), 'utf8')
      .replace(/from (["'])(\\.[^"']+)\\1/g, (_, quote, specifier) =>
        'from ' + JSON.stringify(specifier === './camoufox-session.mjs' ? launchStub : new URL(specifier, source).href));
    code = code.replace(/import\\((["'])\\.\\/account-store\\.mjs\\1\\)/g, 'import(' + JSON.stringify(accountStub) + ')');
    const proxyModule = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    const proxy = await proxyModule.getQwenBrowserProxy({ accountId: ${JSON.stringify(accountId)} });
    await assert.rejects(proxy.captchaPage(), /STOP_BEFORE_BROWSER/);
    process.stdout.write(JSON.stringify({ selected: globalThis.__selectedProfile, home: os.homedir() }));
  `;
  try {
    const { stdout } = await execFileAsync(process.execPath, [`--import=${isolateHome}`, '--input-type=module', '-e', script], {
      cwd: home, env, timeout: 15_000,
    });
    return JSON.parse(stdout);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('expired and invalid accounts keep their saved browser profile when building the proxy', async t => {
  const cases = [
    { accountId: 'expired', profileDir: '/synthetic/saved-expired-profile', invalid: false },
    { accountId: 'invalid', profileDir: '/synthetic/saved-invalid-profile', invalid: true },
  ];
  for (const account of cases) {
    await t.test(account.accountId, async () => {
      const result = await selectedProfile({
        accountId: account.accountId,
        accounts: [{ ...account, id: account.accountId, token: 'synthetic-token' }],
      });
      assert.equal(result.selected, account.profileDir, `${account.accountId} account profile should be retained`);
    });
  }
});

test('an account with no saved metadata keeps the existing fallback profile', async () => {
  const accountId = 'missing';
  const { selected, home } = await selectedProfile({ accountId, accounts: [] });
  assert.equal(selected, path.join(home, '.qwen-cli', `qwen-profile-${accountId}`));
});
