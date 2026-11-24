import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { prepareConversationHandoff } from '../src/harness/handoff.mjs';
import { normalizeRoleId } from '../src/agent-runtime/roles.mjs';

test('actual create-chat route persists a fresh target and no provider requests or source mutation',async()=>{
 const source=fs.readFileSync(new URL('../src/window-app/server.mjs',import.meta.url),'utf8');
 const start=source.indexOf('if (req.method === "POST" && url.pathname === "/api/conversations")');
 const end=source.indexOf('const conversationMatch',start);
 const original={id:'old',provider:'qwen',roleId:'developer',skillId:'bug-fix',workspace:'/project',sessionId:'private',codeSessionId:'private-code',messages:[],
 harnessTask:{id:'task1',status:'completed',goal:'Fix parsing',verification:'passed',changedFiles:['app.mjs'],resultSummary:'Parsing fixed'}};
 const state={conversations:[structuredClone(original)]};let writes=0;
 async function invoke(body, origin="http://127.0.0.1:4317"){const wrapped=vm.runInNewContext('(async function() {'+source.slice(start,end)+'})',{
 req:{method:'POST',headers:{host:'127.0.0.1:4317',origin,'content-type':'application/json'}},url:{pathname:'/api/conversations'},res:{},state,workspaceRoot:'/project',readJsonBody:async()=>body,
 fs:{existsSync:()=>true,statSync:()=>({isDirectory:()=>true})},path,prepareConversationHandoff,isRunning:()=>false,qwenActiveRequests:new Map(),
 getProviderCatalog:()=>({modes:[{id:'fast'}],defaultMode:'fast'}),resolveProviderModel:async()=> 'model1',loadSettings:()=>({ui:{}}),
 randomUUID:()=> 'new',normalizeRoleId,webAccounts:{selected:()=> 'acc_target'},saveWindowState:()=>writes++,logConsole:()=>{},
 sendJson:(_res,data,status=200)=>({status,data})});return wrapped();}
 const result=await invoke({handoffFrom:'old',provider:'glm',roleId:'reviewer',workspace:'/project',handoff:{context:'forged'}});
 assert.equal(result.status,200);assert.equal(writes,1);
 const target=result.data.conversation;assert.equal(target.providerAccountId,'acc_target');assert.equal(target.roleId,'reviewer');assert.equal(target.skillId,'bug-fix');
 assert.equal(target.sessionId,null);assert.equal(target.codeParentMessageId,null);assert.equal(target.codeSessionId,undefined);assert.equal(target.harnessTask,undefined);
 assert.equal(target.messages.length,0);assert.match(target.handoff.context,/Fix parsing/);assert.doesNotMatch(target.handoff.context,/forged/);
 assert.deepEqual(state.conversations.find(c=>c.id==='old'),original);
 assert.equal((await invoke({handoffFrom:'old',provider:'glm',workspace:'/another'})).status,400);assert.equal(writes,1);
 assert.equal((await invoke({handoffFrom:'old',provider:'glm',workspace:'/project'},'https://evil.test')).status,403);
 assert.equal(writes,1);
});
