import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProviderCooldown } from '../src/providers/request-cooldown.mjs';

test('cooldown expires naturally, isolates accounts and does not shorten a longer deadline',()=>{
  const policy=createProviderCooldown({provider:'deepseek',errorCode:'DEEPSEEK_RATE_LIMIT',root:null});
  policy.assertAvailable('a',0);
  assert.equal(policy.recordRateLimit('10','a',1000),10000);
  assert.equal(policy.recordRateLimit('1','a',2000),9000);
  policy.assertAvailable('b',2000);
  assert.throws(()=>policy.assertAvailable('a',3000),e=>e.delivery==='not_sent'&&e.retryAfterMs===8000);
  policy.assertAvailable('a',11000);
});

test('uses the existing 60-second client fallback only when no valid provider deadline exists',()=>{
  const policy=createProviderCooldown({provider:'deepseek',errorCode:'DEEPSEEK_RATE_LIMIT',root:null});
  assert.equal(policy.recordRateLimit('invalid','a',0),60000);
  assert.equal(policy.recordRateLimit('Thu, 01 Jan 1970 00:02:00 GMT','b',0),120000);
  assert.equal(policy.recordRateLimit('0','c',0),0);policy.assertAvailable('c',0);
});

test('persisted restrictions are read fresh and corrupt storage cannot release a request',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'synvox-cooldown-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const make=()=>createProviderCooldown({provider:'deepseek',errorCode:'DEEPSEEK_RATE_LIMIT',root:dir});
  const a=make(),b=make();a.recordRateLimit('60','a',0);
  assert.throws(()=>b.assertAvailable('a',1000),e=>e.retryAfterMs===59000);
  const account=path.join(dir,fs.readdirSync(dir)[0]);
  fs.writeFileSync(path.join(account,fs.readdirSync(account).find(n=>n.endsWith('.json'))),'null');
  assert.throws(()=>b.assertAvailable('a',1000),e=>e.code==='REQUEST_BUDGET_CORRUPT'&&e.delivery==='not_sent');
});
