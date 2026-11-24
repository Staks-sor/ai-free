import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { renderWindowHtml } from '../src/window-app/ui-html.mjs';
import { getHarnessTaskView } from '../src/harness/task-view.mjs';
import { createChatDraftStore } from '../src/window-app/chat-drafts.mjs';

const fixture = () => ({id:'chat',provider:'glm',workspace:'/project',messages:[],harnessTask:{id:'task',provider:'glm',workspace:'/project',goal:'Fix',status:'paused',checkpoint:{phase:'awaiting_model'},failure:{delivery:'rejected'}}});
function action(c,{taskId='task',running=[]}={}) {
 const html=renderWindowHtml({language:'ru'}),start=html.indexOf('async function continueTaskFromPanel('),end=html.indexOf('async function stopTaskFromPanel(',start);
 const drafts=createChatDraftStore();drafts.set('chat','my unsent message');const calls=[],errors=[];
 const fn=vm.runInNewContext('('+html.slice(start,end).trim()+')',{chatDrafts:drafts,getHarnessTaskView,api:async()=>({conversation:c}),appState:{runningTaskIds:running},
 closeTaskPanel:()=>{},loadState:async id=>calls.push(['load',id]),postStreamingMessage:async(id,body)=>calls.push(['model',id,JSON.parse(JSON.stringify(body))]),
 activeConversation:c,t:k=>k,setStatus:message=>errors.push(message)});
 return {run:()=>fn('chat',taskId,{disabled:false}),calls,errors,drafts};
}
test('continue targets one compatible task without losing the unsent draft',async()=>{
 const h=action(fixture());await h.run();assert.equal(h.calls.filter(x=>x[0]==='model').length,1);
 assert.deepEqual(h.calls.find(x=>x[0]==='model').slice(1),['chat',{content:'продолжи',resumeTaskId:'task'}]);
 assert.equal(h.drafts.get('chat'),'my unsent message');assert.equal(h.drafts.isSending('chat'),false);
});
test('blocked or stale tasks do not issue model calls',async()=>{
 for(const variant of ['unknown','stale','busy']) {
  const c=fixture();if(variant==='unknown')c.harnessTask.failure.delivery='unknown';
  const h=action(c,{taskId:variant==='stale'?'old':'task',running:variant==='busy'?['chat']:[]});await h.run();
  assert.equal(h.calls.filter(x=>x[0]==='model').length,0);assert.equal(h.errors.length,1);assert.equal(h.drafts.isSending('chat'),false);
 }
});
test('double continuation clicks are coalesced while the first request runs',async()=>{
 const h=action(fixture());await Promise.all([h.run(),h.run()]);assert.equal(h.calls.filter(x=>x[0]==='model').length,1);
});
