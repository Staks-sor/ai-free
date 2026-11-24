import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeepSeekChatClient } from '../src/providers/deepseek/client.mjs';
import { classifyProviderFailure } from '../src/harness/errors.mjs';

function fixture() {
  let refreshes=0,posts=0;
  const client=new DeepSeekChatClient({cookieHeader:'',token:'',authManager:{refresh:async()=>{refreshes++;return {cookieHeader:'',token:'new'};}}});
  client.createPowHeader=async()=>'';client._ensureSearchFeatureToken=async()=>{};
  const call=operation=>operation==='json'?client.json('/api/test',{method:'POST',body:{}})
    :operation==='upload'?client.uploadFile(Buffer.from('test'),'text/plain','test.txt')
    :client.complete({sessionId:'s',prompt:'test'});
  return {client,call,counts:()=>({refreshes,posts}),respond:(status,text)=>{posts++;return new Response(text,{status,headers:{'content-type':'application/json'}});}};
}

for (const operation of ['json','upload','completion']) {
  for(const body of ['{"code":0,"msg":"forbidden"}','<html><body>Forbidden</body></html>']) {
    test(`${operation}: generic 403 never refreshes login or repeats POST (${body.startsWith('<')?'HTML':'JSON'})`,async()=>{
      const old=globalThis.fetch,f=fixture();
      try{
        globalThis.fetch=async()=>f.respond(403,body);
        await assert.rejects(f.call(operation),e=>e.code==='DEEPSEEK_ACCESS_DENIED'&&e.status===403&&!e.isAuthError&&e.delivery==='unknown'&&classifyProviderFailure(e).kind==='provider_error');
        assert.deepEqual(f.counts(),{posts:1,refreshes:0});
      }finally{globalThis.fetch=old;}
    });
  }
  test(`${operation}: HTML challenge is paused instead of interpreted as an expired session`,async()=>{
    const old=globalThis.fetch,f=fixture();
    try{
      globalThis.fetch=async()=>f.respond(401,'<html><script src="/cdn-cgi/challenge-platform/cf-chl.js"></script></html>');
      await assert.rejects(f.call(operation),e=>e.isChallenge&&!e.isAuthError&&e.delivery==='unknown'&&classifyProviderFailure(e).kind==='challenge_required');
      assert.deepEqual(f.counts(),{posts:1,refreshes:0});
    }finally{globalThis.fetch=old;}
  });
  test(`${operation}: authoritative 401 still uses bounded session refresh`,async()=>{
    const old=globalThis.fetch,f=fixture();
    try{
      globalThis.fetch=async()=>f.respond(401,'Unauthorized');
      await assert.rejects(f.call(operation),e=>e.code==='DEEPSEEK_AUTH_REQUIRED'&&e.isAuthError&&e.delivery==='rejected');
      assert.deepEqual(f.counts(),{posts:3,refreshes:2});
    }finally{globalThis.fetch=old;}
  });
}

test('known JSON expiry codes remain authoritative, even on HTTP 200/403',async()=>{
  const old=globalThis.fetch;
  try{
    for(const [status,code] of [[200,40002],[403,40003]]){
      const f=fixture();globalThis.fetch=async()=>f.respond(status,JSON.stringify({code}));
      await assert.rejects(f.call('completion'),e=>e.isAuthError&&e.delivery==='rejected');
      assert.deepEqual(f.counts(),{posts:3,refreshes:2});
    }
  }finally{globalThis.fetch=old;}
});

test('unknown-delivery auth errors and Stop never open another login or POST',async()=>{
  const f=fixture();
  await assert.rejects(f.client._withReauth(async()=>{throw Object.assign(new Error('uncertain auth'),{isAuthError:true,delivery:'unknown'});}),/uncertain auth/);
  assert.equal(f.counts().refreshes,0);
  const old=globalThis.fetch,controller=new AbortController();
  try{
    globalThis.fetch=async()=>{controller.abort();return f.respond(401,'Unauthorized');};
    await assert.rejects(f.client.complete({sessionId:'s',prompt:'test',signal:controller.signal}),e=>e.name==='AbortError');
    assert.deepEqual(f.counts(),{posts:1,refreshes:0});
  }finally{globalThis.fetch=old;}
});

for (const operation of ['json','upload','completion']) {
  test(`${operation}: HTTP 200 HTML is an unexpected response, without logout or resend`,async()=>{
    const old=globalThis.fetch,f=fixture();
    try{
      globalThis.fetch=async()=>f.respond(200,'<html><body>API temporarily unavailable</body></html>');
      await assert.rejects(f.call(operation),e=>e.code==='DEEPSEEK_UNEXPECTED_RESPONSE'&&!e.isAuthError&&!e.isChallenge&&e.delivery==='unknown');
      assert.deepEqual(f.counts(),{posts:1,refreshes:0});
    }finally{globalThis.fetch=old;}
  });
}
