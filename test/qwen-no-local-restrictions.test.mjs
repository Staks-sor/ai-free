import test from 'node:test';import assert from 'node:assert/strict';
import {resetQwenPacingStateForTests,startQwenPunishCooldown,recordQwenStreamOutcome,assertNoQwenAntibotCooldown,qwenAntibotCooldownRemainingMs,waitForQwenCompletionSlot,registerQwenRetryAfter,getQwenPacingIntervalMs} from '../src/providers/qwen/request-pacing.mjs';
test('punish and empty replies never invent a provider cooldown or adaptive delay',async()=>{
 resetQwenPacingStateForTests();
 const interval=getQwenPacingIntervalMs('a');
 for(let i=0;i<5;i++){assert.equal(startQwenPunishCooldown(1000+i,'a').backoffMs,0);recordQwenStreamOutcome(true,1000+i,'a');}
 assert.equal(qwenAntibotCooldownRemainingMs(1005,'a'),0);
 assert.equal(assertNoQwenAntibotCooldown(1005,'a'),false);
 assert.equal(getQwenPacingIntervalMs('a'),interval);
 await waitForQwenCompletionSlot({accountId:'a',now:1005,sleep:async()=>assert.fail('no synthetic cooldown')});
});
test('only a real server Retry-After blocks dispatch, without an invented fallback minute',()=>{
 resetQwenPacingStateForTests();
 assert.equal(registerQwenRetryAfter(undefined,0,'a'),0);
 assert.equal(assertNoQwenAntibotCooldown(0,'a'),false);
 assert.equal(registerQwenRetryAfter('2',0,'a'),2000);
 assert.throws(()=>assertNoQwenAntibotCooldown(1000,'a'),e=>e.code==='QWEN_RATE_LIMIT'&&e.delivery==='not_sent'&&e.retryAfterMs===1000);
 assert.equal(assertNoQwenAntibotCooldown(2000,'a'),false);
});
