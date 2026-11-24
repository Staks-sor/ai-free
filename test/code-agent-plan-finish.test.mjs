import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {runCodeTask} from '../src/code-agent/run.mjs';
for(const native of [false,true])test(`incomplete saved plan rejects finish and continues actual tool loop (native=${native})`,async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'plan-finish-'));let incomplete=true,count=0;
 try{const result=await runCodeTask({supportsNativeTools:native,complete:async()=>{const call=++count===1?{tool:'finish',message:'Готово'}:count===2?{tool:'update_plan',steps:[{id:'inspect',title:'Изучить проект',status:'completed'}]}:{tool:'finish',message:'Готово'};return native?{toolCall:{id:String(count),name:call.tool,arguments:call}}:{text:JSON.stringify(call)};}},{sessionId:'test'},root,'составь план задачи',null,{memoryEnabled:false,isTaskPlanIncomplete:()=>incomplete,onTool:(call,result)=>{if(call.tool==='update_plan'&&result.ok)incomplete=false}});
 assert.equal(count,3);assert.notEqual(result.failed,true);assert.equal(incomplete,false);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('repeated refusal to finish plan returns failed with a ready resumable checkpoint',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'plan-finish-'));let checkpoint,count=0;
 try{const result=await runCodeTask({complete:async()=>{count++;return {text:'{"tool":"finish","message":"Готово"}'}}},{sessionId:'test'},root,'составь план задачи',null,{memoryEnabled:false,noToolTextRetries:1,isTaskPlanIncomplete:()=>true,onCheckpoint:c=>checkpoint=c});assert.equal(result.failed,true);assert.equal(count,2);assert.equal(checkpoint.phase,'ready');}finally{fs.rmSync(root,{recursive:true,force:true})}
});
