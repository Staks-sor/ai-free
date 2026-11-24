import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAccountActivity } from '../src/providers/account-activity.mjs';

test('default ChatGPT proxy refuses another owner before loading its browser engine', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-owner-'));
  const activity = createAccountActivity({ root: path.join(home, '.deepseek-cli', 'account-activity') });
  const release = activity.acquire('chatgpt', 'default');
  const source = new URL('../src/providers/chatgpt/browser-proxy.mjs', import.meta.url).href;
  const env = { ...process.env, HOME: home };
  delete env.NODE_TEST_CONTEXT;
  try {
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs'; import assert from 'node:assert/strict';
      const source=${JSON.stringify(source)};
      const stub='data:text/javascript,'+encodeURIComponent('export async function getChatGPTChromium(){throw new Error("ENGINE_TOUCHED")} export function getChatGPTEngineName(){return "stub"}');
      const code=fs.readFileSync(new URL(source),'utf8').replace(/from "(\.[^"]+)"/g,(_,s)=>'from '+JSON.stringify(s==='./engine.mjs'?stub:new URL(s,source).href));
      const mod=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
      await assert.rejects(mod.getChatGPTBrowserProxy(),e=>e.code==='ACCOUNT_BUSY');
    `], { cwd: home, env, timeout: 10000 });
  } finally { release(); fs.rmSync(home, { recursive: true, force: true }); }
});
