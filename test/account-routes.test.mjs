import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {handleAccountRequest} from '../src/window-app/account-routes.mjs';
import {createAccountRegistry} from '../src/providers/account-registry.mjs';import {createWebAccountManager} from '../src/providers/web-account-manager.mjs';
test('real account HTTP routes expose ten accounts for every additional provider and reject unsafe mutations',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'synvox-account-http-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const registry=createAccountRegistry({root});const adapters={};
 for(const provider of ['deepseek','chatgpt','glm','googleai'])adapters[provider]={hasLegacy:()=>false,hasAuth:p=>fs.existsSync(p.authFile),login:async p=>fs.writeFileSync(p.authFile,'fixture'),close:async()=>{}};
 const web=createWebAccountManager({registry,adapters}),qwen={waitForLogin:()=>null,snapshot:async()=>({accounts:[]}),action:async()=>({accounts:[]})};
 const server=http.createServer(async(req,res)=>{
 const done=await handleAccountRequest(req,res,new URL(req.url,'http://localhost'),{web,qwen,readBody:async req=>{let data='';for await(const chunk of req)data+=chunk;return JSON.parse(data);},sendJson:(res,body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));}});if(!done){res.writeHead(404);res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});const base='http://127.0.0.1:'+server.address().port;
 const post=(provider,body,origin=base)=>fetch(base+'/api/accounts/'+provider,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('glm',{action:'login'},'https://evil.test')).status,403);
 for(const provider of Object.keys(adapters)){
 for(let n=0;n<10;n++){assert.equal((await post(provider,{action:'login'})).status,200);await web.waitForLogin();}
 assert.equal((await post(provider,{action:'login'})).status,400);const data=await(await fetch(base+'/api/accounts/'+provider)).json();assert.equal(data.accounts.length,10);assert.ok(data.accounts.every(a=>a.status==='ready'));assert.doesNotMatch(JSON.stringify(data),/authFile|profileDir|cookie|token/);
 }
 assert.equal((await fetch(base+'/api/accounts/glm',{method:'DELETE'})).status,405);
});
