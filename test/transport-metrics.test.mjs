import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeMetrics, measureProviderExchange } from '../src/diagnostics/runtime-metrics.mjs';

test('transport observes text separately from thinking and ignores empty content', async () => {
  let now=0; const metrics=createRuntimeMetrics(), chunks=[];
  const value={text:'secret answer'};
  const result=await measureProviderExchange('qwen', async probe => {
    now=5; probe.headers(); now=10; probe.thinking('reason'); probe.text('');
    now=30; probe.text('one'); now=50; probe.text('two'); now=60;
    return value;
  }, { onText:text=>chunks.push(text), now:()=>now, metrics });
  assert.equal(result,value); assert.deepEqual(chunks,['','one','two']);
  const s=metrics.snapshot();
  assert.equal(s['qwen.first_text_ms'].p50,30);
  assert.equal(s['qwen.first_progress_ms'].p50,10);
  assert.equal(s['qwen.content_gap_ms'].max,20);
  assert.equal(s['qwen.headers_ms'].p50,5);
  assert.equal(s['qwen.attempt_ms'].p50,60);
  assert.doesNotMatch(JSON.stringify(s), /reason|secret|answer|one|two/);
});

test('buffered exchange keeps null callbacks and does not invent first-text measurements', async () => {
  const metrics=createRuntimeMetrics();
  await measureProviderExchange('glm', async probe => {
    assert.equal(probe.onText,null); assert.equal(probe.onThinking,null); return {text:'complete'};
  }, {metrics});
  assert.equal(metrics.snapshot()['glm.buffered_attempts'].count,1);
  assert.equal(metrics.snapshot()['glm.first_text_ms'],undefined);
});

test('retry/error measurements never resend, swallow failures or accept arbitrary provider names', async () => {
  const metrics=createRuntimeMetrics(), error=new Error('private error'); let calls=0;
  await assert.rejects(measureProviderExchange('chatgpt', ()=>{calls++; throw error;}, {metrics,attempt:2}),e=>e===error);
  assert.equal(calls,1); assert.equal(metrics.snapshot()['chatgpt.retry_attempts'].count,1);
  assert.equal(metrics.snapshot()['chatgpt.failed_attempts'].count,1);
  await assert.rejects(measureProviderExchange('secret account',()=>assert.fail('called')),/Unknown provider/);
});

test('browser clients expose exchange metrics without forcing streaming or extra sends', async () => {
  const { runtimeMetrics } = await import('../src/diagnostics/runtime-metrics.mjs');
  const { ChatGPTChatClient } = await import('../src/providers/chatgpt/client.mjs');
  const { GLMChatClient } = await import('../src/providers/glm/client.mjs');
  const { GoogleAIChatClient } = await import('../src/providers/google-ai/client.mjs');
  for (const [provider, Client] of [['chatgpt',ChatGPTChatClient],['glm',GLMChatClient],['google-ai',GoogleAIChatClient]]) {
    let sends=0, callback=null;
    const client=new Client({proxyFactory:async()=>({sendChat:async options=>{sends++; assert.equal(options.prompt,'private prompt');
      if (!callback) assert.equal(options.onText,null);
      else { options.onText('a'); options.onText('b'); }
      return {text:'ab'};}})});
    const before=runtimeMetrics.snapshot()[`${provider}.attempt_ms`]?.count || 0;
    await client.complete({prompt:'private prompt'});
    const chunks=[]; callback=text=>chunks.push(text);
    await client.complete({prompt:'private prompt',onText:callback});
    assert.deepEqual(chunks,['a','b']); assert.equal(sends,2);
    const s=runtimeMetrics.snapshot();
    assert.equal(s[`${provider}.attempt_ms`].count,before+2);
    assert.equal(s[`${provider}.first_text_ms`].count >= 1,true);
    assert.equal(s[`${provider}.http_attempts`],undefined);
  }
});

test('DeepSeek counts actual completion POSTs and observes SSE even without a UI callback', async () => {
  const { runtimeMetrics } = await import('../src/diagnostics/runtime-metrics.mjs');
  const { DeepSeekChatClient } = await import('../src/providers/deepseek/client.mjs');
  const client=new DeepSeekChatClient({cookieHeader:'',token:'',debug:false});
  client.createPowHeader=async()=>''; client._ensureSearchFeatureToken=async()=>{};
  const original=globalThis.fetch; let posts=0;
  const before=runtimeMetrics.snapshot()['deepseek.http_attempts']?.count || 0;
  try {
    globalThis.fetch=async()=>{posts++; return new Response('event: ping\ndata: {}\n\ndata: {"v":"one"}\n\ndata: {"v":"two"}\n\n',{headers:{'content-type':'text/event-stream'}});};
    const result=await client.complete({sessionId:'session',prompt:'secret'});
    assert.equal(result.text,'onetwo'); assert.equal(posts,1);
    const s=runtimeMetrics.snapshot(); assert.equal(s['deepseek.http_attempts'].count,before+1);
    assert.equal(s['deepseek.first_text_ms'].count >= 1,true);
    assert.equal(s['deepseek.content_gap_ms'].count >= 1,true);
    assert.equal(s['deepseek.headers_ms'].count >= 1,true);
  } finally { globalThis.fetch=original; }
});

test('Qwen completion boundary keeps transport mode and counts text, not heartbeat/thinking as text', async () => {
  const { fetchQwenCompletionWithMetrics } = await import('../src/providers/qwen/client.mjs');
  const { runtimeMetrics } = await import('../src/diagnostics/runtime-metrics.mjs');
  let sends=0; const chunks=[];
  const proxy={proxyFetch:async request=>{sends++; assert.equal(request.maxAttempts,1); return {text:'buffered'};},
    proxyFetchStream:async request=>{sends++;
      for(const data of [{"response.created":{response_id:'id'}},{choices:[{delta:{content:'think',phase:'think'}}]},
        {choices:[{delta:{content:'hello'}}]},{choices:[{delta:{content:'world'}}]}]) request.onRawChunk(`data: ${JSON.stringify(data)}\n\n`);
      return {text:'',status:200};}};
  const before=runtimeMetrics.snapshot()['qwen.first_text_ms']?.count || 0;
  assert.equal((await fetchQwenCompletionWithMetrics(proxy,{maxAttempts:5})).parser.finish().text,'helloworld');
  const observed=await fetchQwenCompletionWithMetrics(proxy,{maxAttempts:1},{onText:text=>chunks.push(text),attempt:2});
  assert.equal(observed.parser.finish().text,'helloworld'); assert.deepEqual(chunks,['hello','world']);
  assert.equal(sends,2); const s=runtimeMetrics.snapshot();
  assert.equal(s['qwen.first_text_ms'].count,before+2);
  assert.equal(s['qwen.retry_attempts'].count >= 1,true);
  assert.equal(s['qwen.http_attempts'],undefined);
});

test('Qwen direct transport counts POSTs but does not mistake buffered parsing for first text', async () => {
  const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util');
  const source=new URL('../src/providers/qwen/client.mjs',import.meta.url).href;
  const metricsSource=new URL('../src/diagnostics/runtime-metrics.mjs',import.meta.url).href;
  await promisify(execFile)(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';
    const {QwenChatClient}=await import(${JSON.stringify(source)});
    const {runtimeMetrics}=await import(${JSON.stringify(metricsSource)});
    let posts=0; globalThis.fetch=async()=>{posts++;return new Response('data: {"choices":[{"delta":{"content":"answer"}}]}\\n\\n',{headers:{'content-type':'text/event-stream'}});};
    const client=new QwenChatClient({token:'',cookieHeader:''});
    const chunks=[];const result=await client.complete({chatId:'id',prompt:'test',thinking:false,search:false,onText:x=>chunks.push(x)});
    assert.equal(posts,1);assert.equal(result.text,'answer'); assert.deepEqual(chunks,['answer']);
    assert.equal(runtimeMetrics.snapshot()['qwen.http_attempts'].count,1);
    assert.equal(runtimeMetrics.snapshot()['qwen.first_text_ms'],undefined);
  `],{env:{...process.env,QWEN_TRANSPORT:'direct'},timeout:15000});
});

test('DeepSeek thinking markers preserve UI chunks while measuring answer text separately', async () => {
  const { createDeepSeekContentObserver } = await import('../src/providers/deepseek/client.mjs');
  const phases=[], chunks=[];
  const observe=createDeepSeekContentObserver({text:x=>phases.push(['text',x]),thinking:x=>phases.push(['thinking',x])},x=>chunks.push(x));
  observe('<think>\nreason'); observe('more'); observe('\n</think>\n\nanswer');
  assert.deepEqual(chunks,['<think>\nreason','more','\n</think>\n\nanswer']);
  assert.equal(phases.some(([phase,text])=>phase==='text' && text.includes('reason')),false);
  assert.equal(phases.some(([phase,text])=>phase==='text' && text.includes('answer')),true);
});

test('the real Qwen browser completion path succeeds with streamed and buffered mocked transport', async () => {
  const { execFile }=await import('node:child_process'); const {promisify}=await import('node:util');
  const source=new URL('../src/providers/qwen/client.mjs',import.meta.url).href;
  await promisify(execFile)(process.execPath,['--input-type=module','-e',`
    import fs from 'node:fs'; import assert from 'node:assert/strict';
    const source=${JSON.stringify(source)};
    delete process.env.QWEN_COMPLETION_MIN_INTERVAL_MS;
    const stub='data:text/javascript,'+encodeURIComponent('export const getQwenBrowserProxy=async()=>globalThis.proxy; export const resetQwenBrowserProxy=async()=>{};');
    let code=fs.readFileSync(new URL(source),'utf8').replace(/from "(\\.[^"]+)"/g,(_,specifier)=>'from '+JSON.stringify(specifier==='./browser-proxy.mjs'?stub:new URL(specifier,source).href));
    const {QwenChatClient}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
    const pacing=await import(new URL('./request-pacing.mjs',source).href);
    pacing.startQwenPunishCooldown(Date.now()-1000000);
    assert.equal(pacing.qwenAntibotCooldownRemainingMs(),0);
    assert.equal(pacing.getQwenPacingIntervalMs(),0);
    const raw='data: {"choices":[{"delta":{"content":"answer","status":"finished"}}]}\\n\\n';
    let sends=0;globalThis.proxy={proxyFetch:async options=>{assert.equal(typeof options.beforeSend,'function');await options.beforeSend();sends++;return {status:200,text:raw,contentType:'text/event-stream'};},proxyFetchStream:async options=>{assert.equal(typeof options.beforeSend,'function');await options.beforeSend();sends++;options.onRawChunk(raw);return {status:200,text:raw,contentType:'text/event-stream'};}};
    const client=new QwenChatClient({token:'',cookieHeader:''});
    const chunks=[];
    assert.equal((await client.complete({chatId:'id',prompt:'test',onText:x=>chunks.push(x)})).text,'answer');
    assert.equal((await client.complete({chatId:'id',prompt:'test'})).text,'answer');
    assert.equal((await client.complete({chatId:'id',prompt:'test'})).text,'answer');
    assert.equal(pacing.getQwenPacingIntervalMs(),0);
    assert.deepEqual(chunks,['answer']);assert.equal(sends,3);
    const abort=new AbortController();const pending=client.complete({chatId:'id',prompt:'cancel',signal:abort.signal});abort.abort();
    await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(sends,3);
  `],{env:{...process.env,QWEN_TRANSPORT:'browser'},timeout:15000});
});

test('agent completions use stream challenge detection without a UI callback and report uncertain timeouts', async () => {
 const {fetchQwenCompletionWithMetrics}=await import('../src/providers/qwen/client.mjs');
 let calls=0;
 await assert.rejects(fetchQwenCompletionWithMetrics({
   proxyFetch:async()=>assert.fail('agent must use the protected stream path'),
   proxyFetchStream:async()=>{calls++;throw new Error('qwen_page_evaluate_timeout');},
 },{maxAttempts:3}),error=>error.code==='QWEN_BROWSER_TRANSPORT_FAILURE' && error.delivery==='unknown');
 assert.equal(calls,1);
});
