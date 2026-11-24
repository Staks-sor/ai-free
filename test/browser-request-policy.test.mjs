import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import * as policy from '../src/providers/browser-request-policy.mjs';
const response=(url,status=429,method='POST',retryAfter='2')=>({url:()=>url,status:()=>status,headers:()=>({'retry-after':retryAfter}),request:()=>({method:()=>method,isNavigationRequest:()=>method==='GET'})});
for(const [provider,url,method] of [['chatgpt','https://chatgpt.com/backend-api/conversation','POST'],['glm','https://chat.z.ai/api/chat/completions','POST'],['googleai','https://www.google.com/search?q=test&udm=50','GET']]){
 test(`${provider} saves a confirmed restriction and prevents another account-scoped submission`,async()=>{
  const p=policy.createBrowserRequestPolicy(provider,{root:null}),page=new EventEmitter();let calls=0;
  await assert.rejects(p.observe(page,{accountId:'one'},async check=>{check.beforeSend();calls++;page.emit('response',response(url,429,method));check();return 'no';}),e=>e.status===429&&e.delivery==='rejected'&&e.retryAfterMs>0);
  assert.throws(()=>p.assertAvailable('one'),e=>e.delivery==='not_sent');p.assertAvailable('two');assert.equal(calls,1);assert.equal(page.listenerCount('response'),0);
 });
}
test('ignores analytics, another origin, generic 403 and responses before submission',async()=>{
 const p=policy.createBrowserRequestPolicy('glm',{root:null}),page=new EventEmitter();
 const r=await p.observe(page,{},async check=>{page.emit('response',response('https://chat.z.ai/api/chat/completions'));check.beforeSend();page.emit('response',response('https://evil.test/api/chat/completions'));page.emit('response',response('https://chat.z.ai/analytics'));page.emit('response',response('https://chat.z.ai/api/chat/completions',403));check();return 'ok';});assert.equal(r,'ok');p.assertAvailable();
});
test('partial answer or ambiguous Google RPC never permits automatic replay',async()=>{
 const p=policy.createBrowserRequestPolicy('googleai',{root:null}),page=new EventEmitter();
 await assert.rejects(p.observe(page,{},async check=>{check.beforeSend();page.emit('response',response('https://www.google.com/_/SearchUi/data/batchexecute'));check();}),e=>e.delivery==='unknown');
});
test('confirmed 429 after partial text remains unknown delivery',async()=>{
 const p=policy.createBrowserRequestPolicy('chatgpt',{root:null}),page=new EventEmitter();
 await assert.rejects(p.observe(page,{},async check=>{check.beforeSend();check.onText('partial response');page.emit('response',response('https://chatgpt.com/backend-api/conversation'));check();}),e=>e.delivery==='unknown');assert.equal(page.listenerCount('response'),0);
});
test('restriction survives a new policy instance and account isolation',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');const root=fs.mkdtempSync(path.join(os.tmpdir(),'synvox-policy-'));
 try{const p=policy.createBrowserRequestPolicy('glm',{root}),page=new EventEmitter();
 await assert.rejects(p.observe(page,{accountId:'work'},async check=>{check.beforeSend();page.emit('response',response('https://chat.z.ai/api/chat/completions'));check();}));
 const fresh=policy.createBrowserRequestPolicy('glm',{root});assert.throws(()=>fresh.assertAvailable('work'),e=>e.delivery==='not_sent');fresh.assertAvailable('personal');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('abort removes observer and never starts a send',async()=>{
 const p=policy.createBrowserRequestPolicy('glm',{root:null}),page=new EventEmitter(),controller=new AbortController();controller.abort();let sends=0;
 await assert.rejects(p.observe(page,{signal:controller.signal},async check=>{check.beforeSend();sends++;}));assert.equal(sends,0);assert.equal(page.listenerCount('response'),0);
});
