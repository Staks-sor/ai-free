import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {recoverQwenCaptchaState,isQwenCaptchaError} from '../src/providers/qwen/captcha-state.mjs';

for(const status of ['opening','ready','not_shown','login_required','cooldown','error']){
 test(`restart demotes saved ${status} verification while preserving the task and history`,()=>{
  const c={provider:'qwen',messages:[{content:'old error'}],harnessTask:{checkpoint:{phase:'awaiting_model',prompt:'saved'}},pendingQwenCaptcha:{status,accountId:'a',mode:'code',createdAt:'old',challengeVisible:true,error:'old browser error'}};
  const task=JSON.stringify(c.harnessTask),history=JSON.stringify(c.messages);
  assert.equal(recoverQwenCaptchaState({conversations:[c]}),true);
  assert.equal(c.pendingQwenCaptcha.status,'stale');assert.equal(c.pendingQwenCaptcha.challengeVisible,false);
  assert.equal(c.pendingQwenCaptcha.accountId,'a');assert.equal(JSON.stringify(c.harnessTask),task);assert.equal(JSON.stringify(c.messages),history);
  assert.equal(recoverQwenCaptchaState({conversations:[c]}),false);
 });
}

test('stale verification does not open a modal or initiate a browser request',()=>{
 for(const prefix of ['src','plugin-for-vscode/src']){
  const source=readFileSync(`${prefix}/window-app/ui-html.mjs`,'utf8');
  const body=source.match(/function showQwenCaptchaModal\(conversation\) \{([\s\S]*?)const key =/)[1];
  const show=vm.runInNewContext('(function(conversation){'+body+'throw new Error("modal would open");})',{qwenCaptchaOverlay:null,shownQwenCaptchaKey:null});
  show({pendingQwenCaptcha:{status:'stale'}});
 }
});

test('cached local cooldown is not a new Qwen challenge',()=>{
 const source=readFileSync('src/window-app/server.mjs','utf8');
 const body=source.match(/function markQwenCaptcha\([\s\S]*?\n  }/)[0];
 const mark=vm.runInNewContext('('+body+')',{isQwenCaptchaError,Date});
 const c={provider:'qwen',pendingQwenCaptcha:{status:'stale',createdAt:'old',accountId:'a'}};
 mark(c,{code:'QWEN_ANTIBOT_PUNISH',delivery:'not_sent'},'a','code');
 assert.equal(c.pendingQwenCaptcha.status,'stale');assert.equal(c.pendingQwenCaptcha.createdAt,'old');
 mark(c,{code:'QWEN_ANTIBOT_PUNISH',delivery:'rejected'},'a','code');
 assert.equal(c.pendingQwenCaptcha.status,'cooldown');assert.notEqual(c.pendingQwenCaptcha.createdAt,'old');
});

test('Later dismisses a verification until a new challenge instead of reopening it on the next poll',()=>{
 const source=readFileSync('src/window-app/ui-html.mjs','utf8');
 const body=source.match(/dismiss\.addEventListener\("click", \(\) => \{ ([^\n]+) \}\);/)[1];
 const context={overlay:{remove(){}},qwenCaptchaOverlay:{},shownQwenCaptchaKey:'saved-key',key:'saved-key'};
 vm.runInNewContext(body,context);assert.equal(context.qwenCaptchaOverlay,null);assert.equal(context.shownQwenCaptchaKey,'saved-key');
});
