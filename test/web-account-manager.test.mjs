import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createAccountRegistry} from '../src/providers/account-registry.mjs';
import {createWebAccountManager} from '../src/providers/web-account-manager.mjs';
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'synvox-web-accounts-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const registry=createAccountRegistry({root});const adapters={};for(const provider of ['deepseek','chatgpt','glm','googleai']){const legacy=path.join(root,provider+'-legacy.json');adapters[provider]={legacyPaths:{authFile:legacy,profileDir:legacy+'-profile'},hasLegacy:()=>fs.existsSync(legacy),hasAuth:paths=>fs.existsSync(paths.authFile),identity:paths=>{try{return JSON.parse(fs.readFileSync(paths.authFile)).user;}catch{return null;}},login:async(paths)=>{fs.writeFileSync(paths.authFile,JSON.stringify({user:paths.authFile}));},close:async()=>{},buildClient:paths=>({paths})};}return {root,registry,adapters,manager:createWebAccountManager({registry,adapters})};}
for(const provider of ['deepseek','chatgpt','glm','googleai'])test(`${provider}: ten saved accounts with isolated paths, restart, and no eleventh login`,async t=>{
 const {registry,adapters,manager}=setup(t);for(let n=0;n<10;n++){await manager.action(provider,{action:'login'});await manager.waitForLogin();}
 const state=await manager.snapshot(provider);assert.equal(state.accounts.length,10);assert.ok(state.accounts.every(a=>a.status==='ready'));assert.equal(new Set(state.accounts.map(a=>registry.paths(provider,a.id).authFile)).size,10);
 await assert.rejects(manager.action(provider,{action:'login'}),e=>e.code==='ACCOUNT_LIMIT');
 await manager.action(provider,{action:'primary',id:state.accounts[3].id});const fresh=createWebAccountManager({registry,adapters});assert.equal(fresh.selected(provider),state.accounts[3].id);
 const conv={provider,providerAccountId:state.accounts[0].id};assert.equal(fresh.resolve(provider,conv).id,state.accounts[0].id);assert.equal(fresh.resolve(provider).id,state.accounts[3].id);
});
test('legacy default counts towards ten, is not moved, and stale chats stay on it',async t=>{
 const {adapters,manager}=setup(t);fs.writeFileSync(adapters.glm.legacyPaths.authFile,JSON.stringify({user:'legacy'}));assert.equal((await manager.snapshot('glm')).accounts[0].id,'default');
 for(let n=0;n<9;n++){await manager.action('glm',{action:'login'});await manager.waitForLogin();}
 await assert.rejects(manager.action('glm',{action:'login'}),e=>e.code==='ACCOUNT_LIMIT');assert.equal(manager.resolve('glm',{provider:'glm',sessionId:'old'}).id,'default');assert.equal(fs.existsSync(adapters.glm.legacyPaths.authFile),true);
});
test('failed or wrong-user login is not shown connected and busy accounts cannot reconnect',async t=>{
 const {adapters,manager}=setup(t);adapters.chatgpt.login=async()=>{throw new Error('failed');};await manager.action('chatgpt',{action:'login'});await manager.waitForLogin();let state=await manager.snapshot('chatgpt');assert.equal(state.accounts[0].status,'invalid');assert.equal(state.login.state,'failed');
 const id=state.accounts[0].id;adapters.chatgpt.login=async p=>fs.writeFileSync(p.authFile,JSON.stringify({user:'first'}));await manager.action('chatgpt',{action:'login',id});await manager.waitForLogin();
 adapters.chatgpt.login=async p=>fs.writeFileSync(p.authFile,JSON.stringify({user:'different'}));await manager.action('chatgpt',{action:'login',id});await manager.waitForLogin();state=await manager.snapshot('chatgpt');assert.equal(state.accounts[0].status,'invalid');assert.equal(state.login.state,'failed');assert.throws(()=>manager.resolve('chatgpt',{providerAccountId:id}),/переподключ/);
});
test('wrong-user reconnect can recover with the original identity and busy requests retain their profile',async t=>{
 const {registry,adapters,manager}=setup(t);adapters.glm.login=async p=>fs.writeFileSync(p.authFile,JSON.stringify({user:'original'}));await manager.action('glm',{action:'login'});await manager.waitForLogin();const id=(await manager.snapshot('glm')).accounts[0].id;
 adapters.glm.login=async p=>fs.writeFileSync(p.authFile,JSON.stringify({user:'wrong'}));await manager.action('glm',{action:'login',id});await manager.waitForLogin();
 adapters.glm.login=async p=>fs.writeFileSync(p.authFile,JSON.stringify({user:'original'}));await manager.action('glm',{action:'login',id});await manager.waitForLogin();assert.equal((await manager.snapshot('glm')).accounts[0].status,'ready');
 const busy=createWebAccountManager({registry,adapters,isBusy:()=>true});await assert.rejects(busy.action('glm',{action:'login',id}),/завершения/);
});
test('a failed new login with an auth file is blocked until a successful reconnect',async t=>{
 const {adapters,manager}=setup(t);adapters.googleai.login=async p=>{fs.writeFileSync(p.authFile,JSON.stringify({user:'unverified'}));throw new Error('check failed');};await manager.action('googleai',{action:'login'});await manager.waitForLogin();const state=await manager.snapshot('googleai');assert.equal(state.accounts[0].status,'invalid');await assert.rejects(manager.client('googleai'),/переподключ/);
});
test('login metadata write failure remains visible and blocks requests instead of rejecting an unobserved job',async t=>{
 const {registry,manager}=setup(t);const save=registry.setLogin;registry.setLogin=()=>{throw new Error('metadata disk failure');};await manager.action('deepseek',{action:'login'});await manager.waitForLogin();const state=await manager.snapshot('deepseek');assert.equal(state.login.state,'failed');assert.equal(state.accounts[0].status,'invalid');await assert.rejects(manager.client('deepseek'));registry.setLogin=save;
});
test('active model calls block reconnect even from a second manager instance and release after failure',async t=>{
 const {registry,adapters,manager}=setup(t);let finish;adapters.glm.buildClient=()=>({complete:()=>new Promise((_,reject)=>{finish=()=>reject(new Error('model failed'));})});await manager.action('glm',{action:'login'});await manager.waitForLogin();const id=manager.selected('glm');const client=await manager.client('glm');const request=client.complete();const other=createWebAccountManager({registry,adapters});await assert.rejects(other.action('glm',{action:'login',id}),/завершения/);assert.equal((await other.snapshot('glm')).accounts[0].status,'busy');finish();await assert.rejects(request);assert.equal((await other.snapshot('glm')).accounts[0].status,'ready');
});

test('independent provider logins run concurrently and one failure does not clear the other job',async t=>{
 const {adapters,manager}=setup(t);let endDeep,endGlm;
 adapters.deepseek.login=async p=>{await new Promise(r=>{endDeep=r;});fs.writeFileSync(p.authFile,JSON.stringify({user:'deep'}));};
 adapters.glm.login=async()=>{await new Promise(r=>{endGlm=r;});throw new Error('GLM login failed');};
 await manager.action('deepseek',{action:'login'});await manager.action('glm',{action:'login'});
 assert.equal(manager.isLoggingIn('deepseek'),true);assert.equal(manager.isLoggingIn('glm'),true);
 await assert.rejects(manager.action('deepseek',{action:'login'}),/выполняется/);
 endGlm();await manager.waitForLogin('glm');assert.equal((await manager.snapshot('glm')).login.state,'failed');assert.equal(manager.isLoggingIn('deepseek'),true);
 endDeep();await manager.waitForLogin('deepseek');assert.equal((await manager.snapshot('deepseek')).login.state,'done');
});

test('a setup failure preserves an existing authorized account and exposes the real remedy',async t=>{
 const {adapters,manager}=setup(t);await manager.action('deepseek',{action:'login'});await manager.waitForLogin();
 const id=manager.selected('deepseek');adapters.deepseek.login=async()=>{throw Object.assign(new Error('internal install details'),{code:'CAMOUFOX_PYTHON_REQUIRED',userMessage:'Установите Python 3.10+ и перезапустите IDE.'});};
 await manager.action('deepseek',{action:'login',id});await manager.waitForLogin();const s=await manager.snapshot('deepseek');
 assert.equal(s.login.code,'CAMOUFOX_PYTHON_REQUIRED');assert.match(s.login.error,/Python 3\.10/);assert.equal(s.accounts[0].connected,true);assert.equal(manager.hasAuth('deepseek'),true);
});


test('DeepSeek reports login progress until completion and ignores late callbacks',async t=>{
 const {adapters,manager}=setup(t);let report,finish;
 adapters.deepseek.login=async(paths,_id,onProgress)=>{report=onProgress;await new Promise(resolve=>{finish=()=>{fs.writeFileSync(paths.authFile,JSON.stringify({user:'fixture'}));resolve();};});};
 await manager.action('deepseek',{action:'login'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(typeof report,'function');
 report({phase:'captcha',message:'hCaptcha не подтвердила попытку.'});
 assert.deepEqual((await manager.snapshot('deepseek')).login,{state:'running',phase:'captcha',message:'hCaptcha не подтвердила попытку.'});
 finish();await manager.waitForLogin('deepseek');report({phase:'captcha',message:'late'});
 assert.equal((await manager.snapshot('deepseek')).login.state,'done');
});
