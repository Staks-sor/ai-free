import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const source = new URL('../src/providers/qwen/browser-proxy.mjs', import.meta.url).href;

async function navigationUrls({ chatId, parentId, allowNativeRootChat }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-native-navigation-'));
  const isolateHome = path.join(root, 'isolate-home.mjs');
  fs.writeFileSync(isolateHome, `import os from 'node:os'; import { syncBuiltinESMExports } from 'node:module'; os.homedir = () => process.env.SYNVOX_TEST_RUNTIME_ROOT; syncBuiltinESMExports();`);
  const env = { ...process.env, NODE_TEST_CONTEXT: '1', SYNVOX_TEST_RUNTIME_ROOT: root,
    QWEN_BROWSER_CONCURRENCY: '1', QWEN_READY_DELAY_MS: '100', QWEN_READY_POLL_MS: '50' };
  delete env.NODE_OPTIONS;
  const script = `
    import fs from 'node:fs';
    const source = ${JSON.stringify(source)};
    const stubs = {
      '../../browser/session-pool.mjs': 'export const backgroundBrowserPool={proxy:async(_key,create)=>create(),pin:async()=>{}};',
      './config.mjs': 'export const QWEN_AUTH_FILE="/tmp/qwen-test-auth";export const QWEN_BASE_URL="https://chat.qwen.ai";export const QWEN_BROWSER_PROFILE="/tmp/qwen-test-profile";',
      './auth-files.mjs': 'export const applyQwenCookiesToContext=async()=>0;export const readQwenAuth=()=>null;export const seedQwenPageToken=()=>{};',
      './stream-timeouts.mjs': 'export const resolveQwenStreamTimeouts=()=>({fetchMs:1000,responseHeadersMs:1000,firstContentMs:1000});',
      './request-pacing.mjs': 'export const isQwenPunishResponse=()=>false;export const startQwenPunishCooldown=()=>({backoffMs:0});export const clearQwenPunishCooldown=()=>{};',
      './baxia-solver.mjs': 'export const attemptBaxiaSolveFailOpen=async()=>false;export const resolveBaxiaSolverConfig=()=>({enabled:false});export const trySolveBaxiaOnPage=async()=>false;',
      './camoufox-session.mjs': 'export async function launchQwenCamoufoxSession(){const page={urls:[],locator:()=>({waitFor:async()=>{}}),on(){},off(){},goto:async url=>page.urls.push(url),evaluate:async()=>false,waitForFunction:async()=>true,reload:async()=>{},url:()=>page.urls.at(-1),close:async()=>{}};const handlers=new Map();const context={exposeFunction:async(name,fn)=>handlers.set(name,fn),addInitScript:async()=>{},newPage:async()=>page};globalThis.__testPage=page;return {page,context,close:async()=>{},persistStorageState:async()=>{}};}',
      './native-composer.mjs': 'export const submitQwenNativeTurn=async()=>({ok:true,status:200,text:"",contentType:"text/event-stream"});',
      './session-errors.mjs': 'export const createQwenSessionExpiredError=()=>new Error("expired");',
      './harvest.mjs': 'export const harvestQwenCheckpoint=async()=>null;',
      './support-network.mjs': 'export const attachQwenSupportDiagnostics=()=>{};export const logQwenRuntimeNotReady=()=>{};',
      './account-store.mjs': 'export const loadAccounts=()=>[];'
    };
    let code = fs.readFileSync(new URL(source), 'utf8');
    code = code.replace(/from (['"])(\\.[^'"]+|\\.\\.\\/[^'"]+)\\1/g, (match, quote, specifier) => {
      const stub = stubs[specifier];
      if (!stub) return match;
      return 'from ' + JSON.stringify('data:text/javascript,' + encodeURIComponent(stub));
    });
    code = code.replace(/import\\((['"])\\.\\/account-store\\.mjs\\1\\)/g, 'import(' + JSON.stringify('data:text/javascript,' + encodeURIComponent(stubs['./account-store.mjs'])) + ')');
    const proxyModule = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    const proxy = await proxyModule.getQwenBrowserProxy({accountId:'navigation-test'});
    await proxy.submitNativeTurn({chatId:${JSON.stringify(chatId)},prompt:'synthetic prompt',parentId:${JSON.stringify(parentId)},model:'synthetic-model',allowNativeRootChat:${JSON.stringify(allowNativeRootChat)}});
    process.stdout.write(JSON.stringify(globalThis.__testPage.urls));
    await proxyModule.closeQwenBrowserProxy('navigation-test');
  `;
  try {
    const { stdout } = await execFileAsync(process.execPath, [`--import=${isolateHome}`, '--input-type=module', '-e', script], {
      cwd: root, env, timeout: 15_000,
    });
    return JSON.parse(stdout);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('a proven empty root opens the Qwen home page instead of /c/null', async () => {
  const urls = await navigationUrls({ chatId: 'empty-api-chat', parentId: null, allowNativeRootChat: true });
  assert.deepEqual(urls, ['https://chat.qwen.ai', 'https://chat.qwen.ai']);
  assert.ok(urls.every(url => !url.endsWith('/c/null')));
});

test('a saved chat still opens its exact conversation route', async () => {
  const urls = await navigationUrls({ chatId: 'saved-chat', parentId: 'parent-1', allowNativeRootChat: false });
  assert.deepEqual(urls, ['https://chat.qwen.ai', 'https://chat.qwen.ai/c/saved-chat']);
});
