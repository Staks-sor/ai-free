import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { assertTaskContinuation } from '../src/harness/task-view.mjs';

test('task continuation rejects a foreign origin before touching task state',()=>{
 const source=fs.readFileSync(new URL('../src/window-app/server.mjs',import.meta.url),'utf8');
 const start=source.indexOf('if (body.resumeTaskId)'),end=source.indexOf('const qwenCaptchaRetry',start);
 const c={id:'chat',provider:'glm',workspace:'/project',harnessTask:{id:'task',provider:'glm',workspace:'/project',status:'paused',checkpoint:{phase:'awaiting_model'},failure:{delivery:'rejected'}}};
 c.interactionMode='discuss';c.coderMode=false;
 let checks=0;
 const run=origin=>vm.runInNewContext('(function(){'+source.slice(start,end)+'return {status:200,content:body.content};})()',{
 body:{resumeTaskId:'task',content:'ignored'},req:{headers:{host:'127.0.0.1:4317',origin,'content-type':'application/json'}},conversation:c,res:{},
 assertTaskContinuation:(...args)=>{checks++;return assertTaskContinuation(...args);},isRunning:()=>false,qwenActiveRequests:new Map(),sendJson:(_res,data,status)=>({status,data})});
 assert.equal(run('https://evil.test').status,403);assert.equal(checks,0);assert.equal(c.interactionMode,'discuss');
 assert.equal(run('http://127.0.0.1:4317').content,'продолжи');assert.equal(checks,1);assert.equal(c.interactionMode,'execute');assert.equal(c.coderMode,true);
});
