import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { isQwenRuntimeReady, isTransientBrowserError, navigateQwenPage, primeQwenPageAuth, waitForQwenRuntime, watchQwenPunishNavigation } from "../src/providers/qwen/browser-proxy.mjs";
import { clearQwenSessionCookies } from "../src/providers/qwen/browser-login.mjs";
import { fetchQwenCompletionWithMetrics, isQwenTransientBrowserTransportError } from "../src/providers/qwen/client.mjs";

const readyComposer = { locator() { return { async waitFor() {} }; } };

test('native auth waits for the composer before interpreting an SSR login header', async () => {
  const { ensureQwenNativeSession } = await import('../src/providers/qwen/browser-proxy.mjs');
  let ready = false;
  const page = { locator() { return { async waitFor() { ready = true; } }; },
    async evaluate() { assert.equal(ready, true, 'SSR header is not authenticated UI evidence'); return false; } };
  await ensureQwenNativeSession(page);
});

test('a stalled page load is not classified as expired auth', async () => {
  const { ensureQwenNativeSession } = await import('../src/providers/qwen/browser-proxy.mjs');
  const page = { locator() { return { async waitFor() { throw Object.assign(new Error('composer loading timeout'), { name: 'TimeoutError' }); } }; },
    async evaluate() { return true; }, async waitForFunction() { throw Object.assign(new Error('loading'), { name: 'TimeoutError' }); } };
  await assert.rejects(ensureQwenNativeSession(page), error => error.code === 'QWEN_BROWSER_TRANSPORT_FAILURE'
    && !error.isQwenSessionExpired && error.delivery === 'not_sent');
});

test("Qwen preserves history recovery after a response-headers timeout", () => {
  assert.equal(isQwenTransientBrowserTransportError(new Error("qwen_response_headers_timeout")), true);
});

test('a native login page reports recoverable auth before any model dispatch', async () => {
  const { ensureQwenNativeSession, qwenPageNeedsLogin } = await import('../src/providers/qwen/browser-proxy.mjs');
  const page = { ...readyComposer, async evaluate(check) { return check === qwenPageNeedsLogin; } };
  await assert.rejects(() => ensureQwenNativeSession(page), error =>
    error.isQwenSessionExpired === true && error.isAuthError === true && error.delivery === 'not_sent');
});

test('a signed-in native page passes its auth preflight', async () => {
  const { ensureQwenNativeSession } = await import('../src/providers/qwen/browser-proxy.mjs');
  await ensureQwenNativeSession({ ...readyComposer, async evaluate() { return false; } });
});

test('native auth waits for the guest header to settle when a valid token is present', async () => {
  const { ensureQwenNativeSession, qwenPageNeedsLogin } = await import('../src/providers/qwen/browser-proxy.mjs');
  let guest = true, waits = 0;
  const page = {
    ...readyComposer,
    async evaluate(check) { return check === qwenPageNeedsLogin ? guest : true; },
    async waitForFunction(_check, _arg, options) { waits++; assert.ok(options.timeout <= 1000); guest = false; },
  };
  await ensureQwenNativeSession(page);
  assert.equal(waits, 1);
});

test('Stop while native auth hydrates prevents further session preparation', async () => {
  const { ensureQwenNativeSession } = await import('../src/providers/qwen/browser-proxy.mjs');
  const controller = new AbortController();
  let waits = 0;
  const page = { ...readyComposer, async evaluate() { return true; }, async waitForFunction() { waits++; controller.abort(new Error('stopped')); } };
  await assert.rejects(ensureQwenNativeSession(page, { signal: controller.signal }), /stopped/);
  assert.equal(waits, 1);
});

test('unconfirmed guest UI with a live token stays bounded without demanding login', async () => {
  const { ensureQwenNativeSession } = await import('../src/providers/qwen/browser-proxy.mjs');
  let waits = 0;
  const page = { ...readyComposer, async evaluate() { return true; }, async waitForFunction() {
    waits++; throw Object.assign(new Error('auth did not settle'), { name: 'TimeoutError' });
  } };
  await assert.rejects(ensureQwenNativeSession(page), error => error.code === 'QWEN_BROWSER_TRANSPORT_FAILURE'
    && !error.isQwenSessionExpired && error.delivery === 'not_sent');
  assert.ok(waits > 0 && waits <= 10);
});

test("Qwen re-login keeps Google OAuth cookies in its persistent profile", async () => {
  let filter;
  await clearQwenSessionCookies({ async clearCookies(options) { filter = options.domain; } });
  assert.equal(filter.test(".qwen.ai"), true);
  assert.equal(filter.test("chat.qwen.ai"), true);
  assert.equal(filter.test(".google.com"), false);
});

test("Qwen auth priming survives a redirect before any model request is sent", async () => {
  let evaluations = 0;
  let waits = 0;
  const page = {
    async evaluate() {
      evaluations += 1;
      if (evaluations < 3) throw new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation.");
    },
    async waitForLoadState() { waits += 1; },
  };
  await primeQwenPageAuth(page, "test-token", { delay: async () => {} });
  assert.equal(evaluations, 3);
  assert.equal(waits, 2);
});

test("Qwen auth priming does not hide unrelated browser errors", async () => {
  const page = { async evaluate() { throw new Error("permission denied"); } };
  await assert.rejects(() => primeQwenPageAuth(page, "test-token", { delay: async () => {} }), /permission denied/);
});

test("Qwen request waits for Baxia initialization and its device token", () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  try {
    globalThis.document = { readyState: "complete", scripts: [{ src: "https://assets.alicdn.com/g/qwenweb/qwen-chat-fe/0.3.12/js/main.js" }] };
    globalThis.window = { baxiaInitialized: false, __baxia__: { getFYModule: { getUidToken: () => "device-token" } } };
    assert.equal(isQwenRuntimeReady(), false);
    globalThis.window.baxiaInitialized = true;
    assert.equal(isQwenRuntimeReady(), true);
    globalThis.window.__baxia__.getFYModule.getUidToken = () => "";
    assert.equal(isQwenRuntimeReady(), false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("Qwen reloads once if CDN scripts did not initialize before a request", async () => {
  let waits = 0;
  let reloads = 0;
  const page = {
    async waitForFunction() {
      waits += 1;
      if (waits === 1) throw new Error("page.waitForFunction: Timeout 45000ms exceeded.");
    },
    async reload() { reloads += 1; },
  };
  await waitForQwenRuntime(page);
  assert.equal(waits, 2);
  assert.equal(reloads, 1);
});

test("Qwen treats Firefox navigation cancellation before POST as transient", () => {
  assert.equal(isTransientBrowserError(new Error("page.goto: NS_BINDING_ABORTED; maybe frame was detached?")), true);
});

test("Qwen detects Baxia navigation while browser fetch is still pending", async () => {
  const page = new EventEmitter();
  const watch = watchQwenPunishNavigation(page);
  page.emit("request", { url: () => "https://chat.qwen.ai/api/v2/chat/completions/_____tmd_____/punish" });
  const result = await watch.promise;
  assert.equal(result.punish, true);
  watch.dispose();
  assert.equal(page.listenerCount("request"), 0);
});

test("Qwen accepts a cancelled navigation that reached the chat page", async () => {
  const target = "https://chat.qwen.ai/c/123";
  let navigations = 0;
  const page = {
    async goto() { navigations += 1; throw new Error("page.goto: NS_BINDING_ABORTED; maybe frame was detached?"); },
    url() { return target; },
    async waitForLoadState() {},
  };
  await navigateQwenPage(page, target);
  assert.equal(navigations, 1);
});

test("Qwen retries a cancelled navigation before sending the request", async () => {
  const target = "https://chat.qwen.ai/c/123";
  let navigations = 0;
  const page = {
    async goto() { if (++navigations === 1) throw new Error("page.goto: NS_BINDING_ABORTED; maybe frame was detached?"); },
    url() { return "https://chat.qwen.ai/"; },
    async waitForLoadState() {},
  };
  await navigateQwenPage(page, target);
  assert.equal(navigations, 2);
});

test('navigation preserves a browser token renewed after proxy startup', async()=>{
 const previous=globalThis.localStorage;
 let current='fresh-browser-token';
 globalThis.localStorage={getItem:()=>current,setItem:(_k,v)=>{current=v;}};
 try {await primeQwenPageAuth({evaluate:async(fn,value)=>fn(value)},'old-saved-token');assert.equal(current,'fresh-browser-token');}
 finally {globalThis.localStorage=previous;}
});

test('profile restore preserves a refresh cookie renewed by Qwen',async()=>{
 const {applyQwenCookiesToContext}=await import('../src/providers/qwen/auth-files.mjs');let injected;
 const context={cookies:async()=>[{name:'refresh_token',value:'fresh',domain:'.qwen.ai',path:'/'}],addCookies:async(value)=>{injected=value;}};
 await applyQwenCookiesToContext(context,[{name:'refresh_token',value:'old',domain:'.qwen.ai',path:'/'},{name:'other',value:'needed',domain:'.qwen.ai',path:'/'}],{preserveSession:true});
 assert.deepEqual(injected.map(c=>c.name),['other']);
});

test('seeding replaces older JWTs but never replaces a newer browser JWT',async()=>{
 const {seedQwenPageToken}=await import('../src/providers/qwen/auth-files.mjs');
 const jwt=exp=>'eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify({exp})).toString('base64url')+'.sig';
 const previous=globalThis.localStorage;let current=jwt(100);
 globalThis.localStorage={getItem:key=>key==='token'?current:null,setItem:(key,value)=>{if(key==='token')current=value;}};
 try {seedQwenPageToken(jwt(200));assert.equal(current,jwt(200));seedQwenPageToken(jwt(100));assert.equal(current,jwt(200));}
 finally {globalThis.localStorage=previous;}
});


test("Firefox network navigation timeout is an unsent transport failure through the completion boundary", async () => {
  const original = new Error("page.goto: NS_ERROR_NET_TIMEOUT");
  assert.equal(isTransientBrowserError(original), true);
  assert.equal(isQwenTransientBrowserTransportError(original), true);
  let sends = 0, loadChecks = 0;
  const page = {
    async goto() { throw original; },
    async waitForLoadState() { loadChecks++; },
    url() { return "https://chat.qwen.ai/c/chat"; },
  };
  await assert.rejects(fetchQwenCompletionWithMetrics({
    async proxyFetchStream() {
      await navigateQwenPage(page, "https://chat.qwen.ai/c/chat");
      sends++;
    },
  }, { chatId: "chat" }), error => {
    assert.equal(error, original);
    assert.equal(error.code, "QWEN_BROWSER_TRANSPORT_FAILURE");
    assert.equal(error.delivery, "not_sent");
    return true;
  });
  assert.equal(sends, 0);
  assert.equal(loadChecks, 0, "an error document at the requested URL does not prove successful navigation");
});

test('recovery tracks actual completion requests instead of treating a live app process as a live request', async () => {
  const { createQwenCompletionTracker } = await import('../src/providers/qwen/browser-proxy.mjs');
  const tracker = createQwenCompletionTracker();
  const page = new EventEmitter();tracker.attach(page);
  const request = { url: () => 'https://chat.qwen.ai/api/v2/chat/completions?chat_id=c', method: () => 'POST' };
  page.emit('request',request);assert.equal(tracker.pending(),1);
  page.emit('requestfinished',request);assert.equal(tracker.pending(),0);
  page.emit('request',request);page.emit('requestfailed',request);assert.equal(tracker.pending(),0);
  page.emit('request',request);page.emit('close');assert.equal(tracker.pending(),0);
});

test('Qwen supports a versioned main script without bypassing SDK readiness',()=>{
 const doc=globalThis.document,win=globalThis.window;
 try{globalThis.document={readyState:'complete',scripts:[{src:'https://assets.alicdn.com/g/qwenweb/qwen-chat-fe/0.4.0/js/main-ab12.js'}]};globalThis.window={baxiaInitialized:true,__baxia__:{getFYModule:{getUidToken:()=> 'present'}}};assert.equal(isQwenRuntimeReady(),true);globalThis.window.baxiaInitialized=false;assert.equal(isQwenRuntimeReady(),false);}finally{globalThis.document=doc;globalThis.window=win;}
});

test('Qwen readiness failure reports missing components and remains not sent',async()=>{
 let waits=0,reloads=0;
 const page={waitForFunction:async()=>{waits++;throw Object.assign(new Error('Timeout 45000ms exceeded.'),{name:'TimeoutError'});},reload:async()=>{reloads++;},evaluate:async()=>({ready:false,documentReady:true,appScriptPresent:true,sdkInitialized:false,deviceTokenPresent:false})};
 await assert.rejects(waitForQwenRuntime(page),e=>e.code==='QWEN_BROWSER_TRANSPORT_FAILURE'&&e.delivery==='not_sent'&&e.runtime?.sdkInitialized===false&&/Qwen/.test(e.message));assert.equal(waits,2);assert.equal(reloads,1);
});
