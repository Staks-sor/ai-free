import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyProviderFailure, formatHarnessFailureMessage } from '../src/harness/errors.mjs';

test('normalizes confirmed auth, quota, challenge and unknown transport without guessing a ban', () => {
  assert.equal(classifyProviderFailure({ status: 401 }).kind, 'auth_required');
  assert.equal(classifyProviderFailure({ status: 429 }).kind, 'rate_limited');
  assert.equal(classifyProviderFailure({ code: 'QWEN_ANTIBOT_PUNISH', status: 403 }).kind, 'challenge_required');
  assert.equal(classifyProviderFailure({ status: 403, message: 'Forbidden' }).kind, 'provider_error');
  assert.equal(classifyProviderFailure({ code: 'ETIMEDOUT' }).delivery, 'unknown');
  assert.equal(classifyProviderFailure({ code: 'DEEPSEEK_RATE_LIMIT' }).delivery, 'unknown');
  assert.equal(classifyProviderFailure({ name: 'AbortError' }).kind, 'cancelled');
  assert.equal(classifyProviderFailure({ code: 'DEEPSEEK_RATE_LIMIT' }).kind, 'rate_limited');
  assert.equal(classifyProviderFailure({ message: 'assistant explains 401, captcha and quota' }).kind, 'provider_error');
});

test('Qwen login recovery is auth, while a browser timeout remains transport with unknown delivery', () => {
 assert.equal(classifyProviderFailure({code:'QWEN_LOGIN_REQUIRED'}).kind,'auth_required');
 assert.equal(classifyProviderFailure({code:'QWEN_BROWSER_TRANSPORT_FAILURE',delivery:'unknown'}).kind,'transport_error');
 assert.equal(classifyProviderFailure({code:'QWEN_BROWSER_TRANSPORT_FAILURE',delivery:'unknown'}).delivery,'unknown');
});

test('saved transport failures explain the checkpoint and uncertain delivery without asking for login', async () => {
 const {formatHarnessFailureMessage}=await import('../src/harness/errors.mjs');
 const text=formatHarnessFailureMessage({harnessTask:{checkpoint:{phase:'awaiting_model',toolLogs:['read README','read source']},failure:{kind:'transport_error',delivery:'unknown'}}},new Error('qwen_page_evaluate_timeout'));
 assert.match(text,/сохранены/i);
 assert.match(text,/2/);
 assert.match(text,/неизвестно/i);
 assert.doesNotMatch(text,/авториз|войд|сессия истекла/i);
});

test('unknown Qwen reply asks to inspect the provider response rather than files in the project',()=>{
 const c={provider:'qwen',harnessTask:{failure:{kind:'challenge_required',delivery:'unknown'},checkpoint:{phase:'awaiting_model',toolLogs:['read']}}};
 const message=formatHarnessFailureMessage(c,{code:'HARNESS_REVIEW_REQUIRED',message:'Действие было прервано'});
 assert.match(message,/Qwen/);assert.match(message,/сохран[её]н/i);assert.doesNotMatch(message,/Проверьте результат в проекте/);
 assert.match(message,/ответ.*ещё|ещё.*ответ/i);
});
