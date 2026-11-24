import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { isQwenCaptchaError, isQwenCaptchaRetryableTurn } from "../src/providers/qwen/captcha-state.mjs";
import { hasQwenClearanceCookieHeader } from "../src/providers/qwen/browser-proxy.mjs";
import { renderWindowHtml } from "../src/window-app/ui-html.mjs";
import { applyQwenCaptchaPointer, renderEmbedQwenCaptchaHtml } from "../src/window-app/qwen-captcha-live.mjs";

test("only Qwen challenge errors request captcha UI", () => {
  assert.equal(isQwenCaptchaError({ code: "QWEN_ANTIBOT_PUNISH" }), true);
  assert.equal(isQwenCaptchaError({ message: "Qwen Baxia antibot punish (captcha)" }), true);
  assert.equal(isQwenCaptchaError({ code: "QWEN_ACCOUNTS_PAUSED" }), false);
});

test("only the unchanged, unanswered Qwen chat turn can resume after manual verification", () => {
  const conversation = { provider: "qwen", messages: [
    { role: "user", content: "Исходный вопрос" },
    { role: "assistant", content: "Qwen запросил проверку", qwenCaptchaRetryable: true },
  ] };
  const retry = { userIndex: 0, assistantIndex: 1 };
  assert.equal(isQwenCaptchaRetryableTurn(conversation, retry), true);
  assert.equal(isQwenCaptchaRetryableTurn({ ...conversation, messages: [...conversation.messages, { role: "user", content: "Новый вопрос" }] }, retry), false);
    assert.equal(isQwenCaptchaRetryableTurn({ ...conversation, messages: [conversation.messages[0], { role: "assistant", content: "Уже ответил" }] }, retry), false);
});

test("confirmed Qwen challenge resumes the saved chat turn without appending another user message", () => {
  for (const prefix of ["src", "plugin-for-vscode/src"]) {
    const server = readFileSync(`${prefix}/window-app/server.mjs`, "utf8");
    const html = readFileSync(`${prefix}/window-app/ui-html.mjs`, "utf8");
    assert.match(server, /resumeQwenCaptcha === true/);
    assert.match(server, /if \(!qwenCaptchaRetry\) conversation\.messages\.push\(createUserMessage\(\)\)/);
    assert.match(server, /isQwenCaptchaRetryableTurn\(conversation, retry\)/);
    assert.match(html, /resumeQwenCaptcha/);
  }
});

test("Qwen clearance check works from page-visible cookies without browser context management", () => {
  assert.equal(hasQwenClearanceCookieHeader("tfstk=old; x5sec=fresh-token"), true);
  assert.equal(hasQwenClearanceCookieHeader("x5sec=; tfstk=old"), false);
  assert.equal(hasQwenClearanceCookieHeader("other_x5sec=value"), false);
});

test("desktop shows a manual challenge modal and opens the matching account session", () => {
  const html = renderWindowHtml({ language: "ru" });
  assert.match(html, /function showQwenCaptchaModal/);
  assert.match(html, /qwen-captcha\/open/);
  assert.match(html, /qwen-captcha\/done/);
  for (const file of ["src/window-app/server.mjs", "plugin-for-vscode/src/window-app/server.mjs"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /pendingQwenCaptcha/);
    assert.match(source, /openQwenCaptchaBrowser/);
    assert.match(source, /return sendJson\(res, \{ ok: true, opening: true \}\)/);
  }
});

test("manual Qwen challenge is interactive inside SYNVOX using the same account page", () => {
  const html = renderWindowHtml({ language: "ru" });
  assert.match(html, /qwenCaptchaViewport/);
  assert.match(html, /\/embed\/qwen-captcha\?conversationId=/);
  for (const prefix of ["src", "plugin-for-vscode/src"]) {
    const server = readFileSync(`${prefix}/window-app/server.mjs`, "utf8");
    const proxy = readFileSync(`${prefix}/providers/qwen/browser-proxy.mjs`, "utf8");
    const live = readFileSync(`${prefix}/window-app/qwen-captcha-live.mjs`, "utf8");
    assert.match(server, /live-stream\|live-input/);
    assert.match(proxy, /getQwenCaptchaPage/);
    assert.match(live, /qwen-captcha\/live-stream/);
    assert.match(live, /qwen-captcha\/live-input/);
    assert.match(live, /page\.mouse\.down\(\)/);
    assert.match(live, /page\.mouse\.move\(x, y\)/);
    assert.match(live, /page\.mouse\.up\(\)/);
  }
});

test("manual slider gestures reach the existing browser page in order", async () => {
  const calls = [];
  const page = {
    viewportSize: () => ({ width: 1280, height: 800 }),
    mouse: {
      move: async (x, y) => calls.push(["move", x, y]),
      down: async () => calls.push(["down"]),
      up: async () => calls.push(["up"]),
    },
  };
  await applyQwenCaptchaPointer(page, { type: "pointerdown", x: 100, y: 450 });
  await applyQwenCaptchaPointer(page, { type: "pointermove", x: 300, y: 450 });
  await applyQwenCaptchaPointer(page, { type: "pointerup", x: 430, y: 450 });
  assert.deepEqual(calls, [
    ["move", 100, 450], ["down"],
    ["move", 300, 450],
    ["move", 430, 450], ["up"],
  ]);
  await assert.rejects(applyQwenCaptchaPointer(page, { type: "evaluate", x: 0, y: 0 }), /Unsupported pointer action/);
});

test("embedded Qwen slider coalesces rapid pointer moves without delaying release", async () => {
  const html = renderEmbedQwenCaptchaHtml("chat-id");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const listeners = new Map(), sent = [];
  const image = { naturalWidth: 1280, naturalHeight: 800 };
  const view = {
    querySelector: () => image,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
    addEventListener: (name, handler) => listeners.set(name, handler),
    setPointerCapture: () => {},
  };
  vm.runInNewContext(script, {
    document: { getElementById: () => view },
    fetch: async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: true }; },
  });
  const event = x => ({ clientX: x, clientY: 300, pointerId: 1 });
  listeners.get("pointerdown")(event(10));
  for (let x = 20; x <= 400; x += 10) listeners.get("pointermove")(event(x));
  listeners.get("pointerup")(event(410));
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(sent.map(item => item.type)[0], "pointerdown");
  assert.ok(sent.filter(item => item.type === "pointermove").length <= 2, "intermediate moves should be coalesced");
  assert.deepEqual(sent.at(-1).type, "pointerup");
  assert.equal(sent.at(-1).x, 410);
});

test("background proxy recovery cannot close a captcha window before verification", () => {
  for (const file of ["src/providers/qwen/browser-proxy.mjs", "plugin-for-vscode/src/providers/qwen/browser-proxy.mjs"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /export function resetQwenBrowserProxy\(accountId = null\) \{\s*if \(accountId && visibleCaptchaAccounts\.has\(accountId\)\) return Promise\.resolve\(\);/);
    assert.match(source, /export async function openQwenCaptchaBrowser[\s\S]*?visibleCaptchaAccounts\.add\(accountId\);[\s\S]*?await proxy\.showCaptchaWindow\(\)/);
    assert.match(source, /createProxy\(\{ accountId, debug, visible: false \}\)/);
    assert.doesNotMatch(source, /export async function openQwenCaptchaBrowser[\s\S]*?await closeQwenBrowserProxy\(accountId\);[\s\S]*?export async function getQwenCaptchaPage/);
  }
});

test("only provider-confirmed manual verification clears the local Qwen cooldown", () => {
  for (const file of ["src/providers/qwen/browser-proxy.mjs", "plugin-for-vscode/src/providers/qwen/browser-proxy.mjs"]) {
    const source = readFileSync(file, "utf8");
    const finish = source.match(/export async function finishQwenCaptchaBrowser[\s\S]*?\n}\n/)?.[0] || "";
    assert.match(finish, /if \(!await confirmQwenCaptchaProxy\(proxy, chatId\)\) return false;[\s\S]*?clearQwenPunishCooldown\(accountId\)/);
  }
});

test("ordinary Qwen home is not reported as a captcha challenge, but later manual clearance can be confirmed", () => {
  for (const file of ["src/providers/qwen/browser-proxy.mjs", "plugin-for-vscode/src/providers/qwen/browser-proxy.mjs"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /async showCaptchaWindow\(\)[\s\S]*?challengeVisible/);
    const openMethod = source.match(/async showCaptchaWindow\(\) \{[\s\S]*?return \{ challengeVisible \};\s*\}/)?.[0] || "";
    assert.doesNotMatch(openMethod, /waitForTimeout\(1500\)/);
  }
  for (const file of ["src/window-app/server.mjs", "plugin-for-vscode/src/window-app/server.mjs"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /pendingCaptcha\.challengeVisible = result\.challengeVisible === true/);
    assert.doesNotMatch(source, /if \(!conversation\.pendingQwenCaptcha\.challengeVisible\)/);
    assert.match(source, /\["ready", "not_shown"\]\.includes\(conversation\.pendingQwenCaptcha\.status\)/);
    assert.match(source, /status: "cooldown"/);
    assert.match(source, /qwenCaptchaMatch\[2\] === "done" && conversation\.pendingQwenCaptcha\.status === "cooldown"/);
  }
  for (const html of [renderWindowHtml({ language: "ru" })]) {
    assert.match(html, /Капча не появилась в Qwen/);
    assert.match(html, /pending\?\.status === "not_shown"[\s\S]*?done\.disabled = false/);
    assert.doesNotMatch(html, /open\.disabled = cooldownOnly/);
  }
});

test('a failed challenge browser launch shows a local browser error instead of a new account limit', () => {
  const html=renderWindowHtml({language:'ru'});
  const start=html.indexOf('      function showBrowserError(message)');
  const end=html.indexOf('      if (conversation.pendingQwenCaptcha.status === "error")',start);
  const title={},help={},status={};
  const context=vm.createContext({title,help,status});
  vm.runInContext(html.slice(start,end)+'\nshowBrowserError("Integer exceeds 64-bit range");',context);
  assert.equal(title.textContent,'Не удалось открыть браузер Qwen');
  assert.match(help.textContent,/локального браузера/);
  assert.equal(status.textContent,'Integer exceeds 64-bit range');
});

test('a coding challenge keeps the code account instead of opening the default chat profile', () => {
 const source=readFileSync('src/window-app/server.mjs','utf8');
 const start=source.indexOf('  function markQwenCaptcha(');
 const end=source.indexOf('  providerAccountPool.register',start);
 const conversation={qwenCodeAccountId:'code-account',qwenAccountId:'chat-account'};
 const context=vm.createContext({conversation,isQwenCaptchaError:()=>true});
 vm.runInContext(source.slice(start,end)+'\nmarkQwenCaptcha(conversation,{code:"QWEN_ANTIBOT_PUNISH"},conversation.qwenCodeAccountId);',context);
 assert.equal(conversation.pendingQwenCaptcha.accountId,'code-account');
 assert.match(source,/markQwenCaptcha\(conversation, err, conversation.qwenCodeAccountId/);
});

test('visible Qwen sign-in controls identify a guest page, not a manual challenge', async () => {
 const {qwenPageNeedsLogin}=await import('../src/providers/qwen/browser-proxy.mjs');
 const code='('+qwenPageNeedsLogin.toString()+')()';
 const run=labels=>vm.runInNewContext(code,{document:{querySelectorAll:()=>labels.map(([label,visible])=>({innerText:label,getClientRects:()=>visible?[{}]:[]}))}});
 assert.equal(run([['Войти',true]]),true);
 assert.equal(run([['Sign in',true]]),true);
 assert.equal(run([['Войти',false],['Мой профиль',true]]),false);
});

test('verification without a visible captcha uses an authenticated history read and keeps generation open', async()=>{
 const {confirmQwenCaptchaProxy}=await import('../src/providers/qwen/browser-proxy.mjs');
 let reads=0;
 const proxy={showCaptchaWindow:async()=>({challengeVisible:false,loginRequired:false}),hasCaptchaClearance:async()=>false,
  proxyApiGet:async({path})=>{reads++;assert.match(path,/\/api\/v2\/chats\/saved/);return {ok:true,status:200,json:{success:true,data:{chat:{messages:[]}}}};}};
 assert.equal(await confirmQwenCaptchaProxy(proxy,'saved'),true);assert.equal(reads,1);
 proxy.showCaptchaWindow=async()=>({challengeVisible:true,loginRequired:false});
 assert.equal(await confirmQwenCaptchaProxy(proxy,'saved'),false);assert.equal(reads,1);
 proxy.showCaptchaWindow=async()=>({challengeVisible:false,loginRequired:true});
 assert.equal(await confirmQwenCaptchaProxy(proxy,'saved'),false);
 proxy.showCaptchaWindow=async()=>({challengeVisible:false,loginRequired:false});
 proxy.proxyApiGet=async()=>({ok:false,status:401,json:null});
 assert.equal(await confirmQwenCaptchaProxy(proxy,'saved'),false);
});

test('captcha confirmation exposes auth persistence through the pooled proxy',()=>{
 for(const prefix of ['src','plugin-for-vscode/src']){
  const source=readFileSync(`${prefix}/providers/qwen/browser-proxy.mjs`,'utf8');
  const factory=source.match(/export function getQwenBrowserProxy[\s\S]*?\n}/)[0];
  let exposed=[];
  const create=vm.runInNewContext('('+factory.replace('export ','')+')',{
   proxyContexts:new Map(),createProxy:()=>{},backgroundBrowserPool:{proxy:(_id,_factory,methods)=>{exposed=methods;return {};}}});
  create({accountId:'test'});assert.ok(exposed.includes('saveCurrentAuth'));
 }
});
