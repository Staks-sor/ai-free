import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as glm from '../src/providers/glm/browser-proxy.mjs';

test('GLM accepts the same text from a new assistant message',()=>{
 const before={text:'ОК',lastMessageId:'old',assistantCount:1};
 assert.equal(glm.isGLMAnswerSnapshotChanged(before,{text:'ОК',lastMessageId:'new',assistantCount:2}),true);
 assert.equal(glm.isGLMAnswerSnapshotChanged(before,{...before,ready:true}),false);
});
test('GLM tracks streaming changes and falls back to text only when identity is absent',()=>{
 const before={text:'old',lastMessageId:'same',assistantCount:1};
 assert.equal(glm.isGLMAnswerSnapshotChanged(before,{...before,text:'new'}),true);
 assert.equal(glm.isGLMAnswerSnapshotChanged({text:'ОК',assistantCount:0},{text:'ОК',assistantCount:1}),true);
 assert.equal(glm.isGLMAnswerSnapshotChanged({text:'ОК'},{text:'ОК'}),false);
 assert.equal(glm.isGLMAnswerSnapshotChanged(before,{text:'',lastMessageId:'new',assistantCount:2}),false);
});

test('actual GLM wait returns a repeated answer from a new message without another send',async()=>{
 const page={context:()=>({cookies:async()=>[]}),evaluate:async fn=>fn.toString().includes('authToken:')
   ?{hasComposer:true,authToken:'test-token',hasVerification:false,hasSignIn:false}
   :{assistantTexts:['ОК'],lastMessageId:'new',assistantCount:2,ready:true}};
 const chunks=[];
 assert.equal(await glm.waitForGLMAnswer(page,{text:'ОК',lastMessageId:'old',assistantCount:1},t=>chunks.push(t),false,AbortSignal.timeout(5000)),'ОК');
 assert.deepEqual(chunks,['ОК']);
});
test('actual GLM wait never returns the old answer while waiting for a new turn',async()=>{
 const page={context:()=>({cookies:async()=>[]}),evaluate:async fn=>fn.toString().includes('authToken:')
   ?{hasComposer:true,authToken:'test-token',hasVerification:false,hasSignIn:false}
   :{assistantTexts:['ОК'],lastMessageId:'old',assistantCount:1,ready:true}};
 await assert.rejects(glm.waitForGLMAnswer(page,{text:'ОК',lastMessageId:'old',assistantCount:1},()=>assert.fail('old answer'),false,AbortSignal.timeout(50)),{name:'AbortError'});
});

test('GLM removes the collapsed reasoning heading even without an Итог marker',()=>{
 assert.equal(glm.normalizeGLMAnswer('Thought Process\n\nОК'),'ОК');
 assert.equal(glm.normalizeGLMAnswer('Thought Process is a phrase in this sentence'),'Thought Process is a phrase in this sentence');
});

test('GLM never treats the Thinking placeholder or known response errors as an answer',()=>{
 assert.equal(glm.normalizeGLMAnswer('Thinking...'),'');
 assert.equal(glm.normalizeGLMAnswer('Thinking…'),'');
 assert.equal(glm.selectGLMAnswerText({assistantTexts:['No response, Please try again later.']}),'');
});

test('GLM wait does not stream or return a new Thinking placeholder',async()=>{
 const page={context:()=>({cookies:async()=>[]}),evaluate:async fn=>fn.toString().includes('authToken:')
   ?{hasComposer:true,authToken:'test-token',hasVerification:false,hasSignIn:false}
   :{assistantTexts:['Thinking...'],lastMessageId:'new',assistantCount:2,ready:true}};
 const chunks=[];
 await assert.rejects(glm.waitForGLMAnswer(page,{text:'old',lastMessageId:'old',assistantCount:1},text=>chunks.push(text),false,AbortSignal.timeout(50)),{name:'AbortError'});
 assert.deepEqual(chunks,[]);
});

test('GLM rejects an observed response error instead of waiting to return it',async()=>{
 const page={context:()=>({cookies:async()=>[]}),evaluate:async fn=>fn.toString().includes('authToken:')
   ?{hasComposer:true,authToken:'test-token',hasVerification:false,hasSignIn:false}
   :{assistantTexts:['No response, Please try again later.'],rawText:'No response, Please try again later.',lastMessageId:'new',assistantCount:2,ready:true}};
 await assert.rejects(glm.waitForGLMAnswer(page,{text:'old',lastMessageId:'old',assistantCount:1},()=>assert.fail('must not stream error text'),false,AbortSignal.timeout(100)),/temporary response failure/);
});

test('GLM snapshot counts each outer assistant message once and excludes user/anchor nodes',async()=>{
 const {runInNewContext}=await import('node:vm');
 const make=(id,text,{user=false,anchor=false,parent=null}={})=>({id,parentElement:parent,
   classList:{contains:()=>user},closest:()=>user?{}:null,
   getBoundingClientRect:()=>({height:anchor?0:30}),querySelector:()=>({innerText:text}),getAttribute:()=>null});
 const outer=make('message-new','ОК');
 const nodes=[make('message-user','question',{user:true}),outer,
   make('','ОК',{parent:{closest:()=>outer}}),make('message-new-start','',{anchor:true})];
 const document={querySelectorAll:s=>s==='button, [aria-label]'?[]:nodes};
 const result=await glm.readGLMAnswerSnapshot({evaluate:async fn=>runInNewContext(`(${fn.toString()})()`,{document,getComputedStyle:()=>({display:'block',visibility:'visible'})})});
 assert.equal(result.assistantCount,1);assert.equal(result.lastMessageId,'message-new');assert.equal(result.text,'ОК');
 assert.equal(result.assistantTexts.length,1);
});
