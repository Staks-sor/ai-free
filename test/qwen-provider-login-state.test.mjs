import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

for (const prefix of ['', 'plugin-for-vscode/']) {
  const source=fs.readFileSync(new URL('../'+prefix+'src/window-app/server.mjs',import.meta.url),'utf8');
  test(prefix+' provider list reflects automatic account login and its failure',async()=>{
    const start=source.indexOf('const providers = await Promise.all');
    const end=source.indexOf('return sendJson(res, { providers });',start);
    let login={state:'running'};
    const providerLoginStates=new Map();
    const context=vm.createContext({listProviders:()=>[{id:'qwen',name:'Qwen',hasAuth:()=>false}],
      qwenAccounts:{snapshot:async()=>({accounts:[],login})},webAccounts:{snapshot:()=>{throw new Error('wrong manager');}},providerLoginStates});
    vm.runInContext('globalThis.read=async()=>{'+source.slice(start,end)+'return providers;}',context);
    assert.equal((await context.read())[0].loginState,'running');
    login={state:'failed',error:'page.goto: timeout'};
    assert.equal((await context.read())[0].loginState,'error');
    assert.equal((await context.read())[0].loginError,'page.goto: timeout');
    login={state:'done'};
    assert.equal((await context.read())[0].loginState,'completed');
    assert.equal((await context.read())[0].hasAuth,false,'completion is not proof of usable auth');
    login={state:'idle'};
    providerLoginStates.set('qwen',{state:'error',error:'account busy before login'});
    assert.equal((await context.read())[0].loginState,'error','pre-start failures must not be masked by idle manager');
  });
  test(prefix+' explicit Qwen login does not wait on silent renewal before opening',()=>{
    const start=source.indexOf('const existingAccount = selectQwenReconnectAccount');
    const end=source.indexOf('await qwenAccounts.waitForLogin()',start);
    assert.ok(start>0&&end>start);
    assert.doesNotMatch(source.slice(start,end),/trySilent:\s*true/);
  });
}

for(const prefix of ['', 'plugin-for-vscode/'])test(prefix+' DeepSeek login route is independent from a pending Qwen login',async()=>{
 const source=fs.readFileSync(new URL('../'+prefix+'src/window-app/server.mjs',import.meta.url),'utf8');
 const start=source.indexOf('if (["deepseek", "chatgpt", "glm", "googleai"].includes(providerId))');const end=source.indexOf('if (providerLoginJobs.has(providerId))',start);
 let calls=0;const ctx=vm.createContext({providerId:'deepseek',qwenAccounts:{waitForLogin:()=>Promise.resolve()},webAccounts:{snapshot:async()=>({accounts:[],login:{state:'idle'}}),action:async()=>{calls++;}},sendJson:(_res,v)=>v,res:{}});
 const result=await vm.runInContext('(async()=>{'+source.slice(start,end)+'})()',ctx);assert.equal(calls,1);assert.equal(result.loginStarted,true);
});
