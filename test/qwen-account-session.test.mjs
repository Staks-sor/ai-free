import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderAccountPool } from '../src/providers/account-pool.mjs';
import { createQwenAccountSession, qwenQuotaError } from '../src/providers/qwen/account-session.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCodeTask } from '../src/code-agent/run.mjs';
import { createQwenAgentAdapter } from '../src/providers/qwen/agent-adapter.mjs';

test('renewal transport failure preserves account health and never starts manual login', async () => {
  const pool = createProviderAccountPool();
  pool.register('qwen', { listAccounts: () => [{ id: 'saved', token: 'old-token', primary: true }] });
  const failure = Object.assign(new Error('Qwen temporarily unavailable'), { code: 'QWEN_SESSION_REFRESH_UNAVAILABLE' });
  let invalidations = 0, logins = 0;
  const session = createQwenAccountSession({ pool, affinityKey: 'network-renewal',
    initial: { accountId: 'saved', chatId: 'saved-chat' },
    buildClient: async () => ({ complete: async () => { throw Object.assign(new Error('expired'), { isQwenSessionExpired: true }); } }),
    refreshAccount: async () => { throw failure; }, markLimited: () => assert.fail('must not limit account'),
    markInvalid: () => { invalidations++; }, onLoginRequired: async () => { logins++; return false; } });
  await assert.rejects(session.complete({ prompt: 'hello' }), error => error === failure);
  assert.equal(invalidations, 0);
  assert.equal(logins, 0);
});

function fixture({ autoSwitch = true, fail = true } = {}) {
  const accounts = [{ id: 'a', primary: true }, { id: 'b' }];
  const pool = createProviderAccountPool();
  pool.register('qwen', { listAccounts: () => accounts });
  const calls = [], notices = [];
  const session = createQwenAccountSession({ pool, affinityKey: 'chat', autoSwitch: () => autoSwitch,
    markLimited: id => { accounts.find(a => a.id === id).limited = true; },
    buildClient: async account => ({
      createChat: async () => account.id + '-chat',
      complete: async opts => {
        calls.push({ account: account.id, ...opts });
        if (account.id === 'a' && fail) throw Object.assign(new Error('limit'), { code: 'QWEN_QUOTA_EXHAUSTED' });
        return { text: 'done', lastMessageId: account.id + '-parent' };
      },
    }),
    context: () => 'Goal: fix tests. Already executed: write file a.js; tests passed. Next: inspect result.',
    onSwitch: event => notices.push(event),
  });
  return { session, calls, accounts, pool, notices };
}

test('confirmed quota switches once, uses fresh upstream IDs and carries checkpoint without rerunning tools', async () => {
  const { session, calls, pool, notices } = fixture();
  await session.createChat({});
  let tools = 1; // A tool executed before this model request. The task loop is not restarted.
  const result = await session.complete({ prompt: 'Tool result: file written', parentId: 'old-parent' });
  assert.equal(result.recoveredChatId, 'b-chat');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].parentId, null);
  assert.match(calls[1].prompt, /Already executed: write file/);
  assert.equal(notices.length, 1);
  await session.complete({ prompt: 'next', parentId: 'b-parent' });
  assert.equal(calls[2].account, 'b');
  assert.equal(calls[2].parentId, 'b-parent');
  assert.equal(tools, 1);
  assert.ok((await pool.snapshot('qwen')).every(a => !a.busy));
});

test('disabled automatic switching stops without using reserve', async () => {
  const { session, calls } = fixture({ autoSwitch: false });
  await assert.rejects(session.complete({ prompt: 'task' }), /Аккаунты AI/);
  assert.equal(calls.length, 1);
});

test('all limited accounts pause; no fallback to legacy or repeated account', async () => {
  const { session, accounts, calls } = fixture();
  accounts[1].disabled = true;
  await assert.rejects(session.complete({ prompt: 'task' }), /Нет доступных/);
  assert.equal(calls.length, 1);
});

test('recovers an updated Qwen profile automatically when every account is marked invalid', async () => {
  const accounts = [{ id: 'a', invalid: true }];
  const pool = createProviderAccountPool();
  pool.register('qwen', { listAccounts: () => accounts });
  let recovered = 0;
  const session = createQwenAccountSession({ pool,
    recoverUnavailable: async () => { recovered++; accounts[0].invalid = false; },
    buildClient: async () => ({ createChat: async () => 'chat', complete: async () => ({ text: 'ok' }) }),
  });
  assert.equal((await session.complete({ prompt: 'continue' })).text, 'ok');
  assert.equal(recovered, 1);
});

test('abort prevents a model request', async () => {
  const { session, calls } = fixture();
  const abort = new AbortController(); abort.abort();
  await assert.rejects(session.complete({ prompt: 'task', signal: abort.signal }));
  assert.equal(calls.length, 0);
});

test('expired credentials are isolated without trying a different identity; network errors never rotate', async () => {
  for (const failure of [Object.assign(new Error('expired'), { isQwenSessionExpired: true }), new Error('network timeout')]) {
    const pool = createProviderAccountPool(); pool.register('qwen', { listAccounts: () => [{id:'a'}, {id:'b'}] });
    const invalid = [], used = [];
    const session = createQwenAccountSession({ pool, markInvalid: id => invalid.push(id),
      buildClient: async account => { used.push(account.id); return { createChat: async () => { throw failure; } }; },
    });
    await assert.rejects(session.complete({prompt:'task'}));
    assert.deepEqual(used, ['a']);
    assert.equal(invalid.length, failure.isQwenSessionExpired ? 1 : 0);
  }
});

test('expired Qwen token refreshes the same account once and retries the rejected request', async () => {
  const accounts = [{ id: 'a', token: 'old' }, { id: 'b', token: 'reserve' }];
  const pool = createProviderAccountPool();
  pool.register('qwen', { listAccounts: () => accounts });
  const used = [], invalid = [], refreshed = [];
  const session = createQwenAccountSession({ pool, affinityKey: 'chat',
    markInvalid: id => invalid.push(id),
    refreshAccount: async account => {
      refreshed.push(account.id);
      accounts[0].token = 'fresh';
      return accounts[0];
    },
    buildClient: async account => ({
      createChat: async () => 'existing-chat',
      complete: async () => {
        used.push({ id: account.id, token: account.token });
        if (account.token === 'old') throw Object.assign(new Error('Token has expired'), { isQwenSessionExpired: true });
        return { text: 'answer', lastMessageId: 'reply' };
      },
    }),
  });
  assert.equal((await session.complete({ prompt: 'hello' })).text, 'answer');
  assert.deepEqual(refreshed, ['a']);
  assert.deepEqual(used, [{ id: 'a', token: 'old' }, { id: 'a', token: 'fresh' }]);
  assert.deepEqual(invalid, []);
});

test('Qwen asks for manual reconnect if the saved profile still has the expired token', async () => {
  const accounts = [{ id: 'a', token: 'old' }, { id: 'b', token: 'reserve' }];
  const pool = createProviderAccountPool();
  pool.register('qwen', { listAccounts: () => accounts });
  const used = [], invalid = [];
  const session = createQwenAccountSession({ pool, affinityKey: 'chat',
    markInvalid: id => invalid.push(id),
    refreshAccount: async account => account,
    buildClient: async account => ({
      createChat: async () => 'chat',
      complete: async () => {
        used.push(account.id);
        throw Object.assign(new Error('Token has expired'), { isQwenSessionExpired: true });
      },
    }),
  });
  await assert.rejects(session.complete({ prompt: 'hello' }), /Переподключите этот аккаунт/);
  assert.deepEqual(used, ['a']);
  assert.deepEqual(invalid, ['a']);
});

test('a chat pinned to an invalid Qwen account never moves to another identity without a quota error', async () => {
  const accounts = [{ id: 'acc_old', invalid: true }, { id: 'acc_reserve' }];
  const pool = createProviderAccountPool();
  pool.register('qwen', { listAccounts: () => accounts });
  const used = [], switches = [];
  const session = createQwenAccountSession({ pool, affinityKey: 'chat',
    initial: { accountId: 'acc_old', chatId: 'old-chat' },
    recoverUnavailable: async () => {},
    onSwitch: event => switches.push(event),
    buildClient: async account => { used.push(account.id); return { createChat: async () => 'new-chat', complete: async () => ({ text: 'answer' }) }; },
  });
  await assert.rejects(session.complete({ prompt: 'continue' }), /Переподключите.*Qwen|Аккаунт.*Qwen/i);
  assert.deepEqual(used, []);
  assert.deepEqual(switches, []);
});

test('Qwen reports expired browser login when automatic account recovery cannot renew it', async () => {
  const pool = createProviderAccountPool();
  pool.register('qwen', { listAccounts: () => [] });
  const reconnects = [];
  const session = createQwenAccountSession({ pool, affinityKey: 'expired-chat',
    recoverUnavailable: async () => ({ expired: true }),
    onLoginRequired: async accountId => { reconnects.push(accountId); return false; },
    buildClient: async () => { throw new Error('must not send'); },
  });
  await assert.rejects(session.complete({ prompt: 'continue' }), error =>
    error.code === 'QWEN_LOGIN_REQUIRED' && /Сессия Qwen истекла/.test(error.message));
  assert.deepEqual(reconnects, [null]);
});

test('Qwen waits for visible reconnect and continues an unsent request once login succeeds', async () => {
  const accounts = [{ id: 'a', token: 'expired', invalid: true }];
  const pool = createProviderAccountPool();
  pool.register('qwen', { listAccounts: () => accounts });
  let reconnects = 0, sends = 0;
  const session = createQwenAccountSession({ pool, affinityKey: 'chat',
    recoverUnavailable: async () => ({ expired: true }),
    onLoginRequired: async accountId => {
      assert.equal(accountId, null);
      reconnects++;
      accounts[0].token = 'fresh';
      accounts[0].invalid = false;
      return true;
    },
    buildClient: async () => ({
      createChat: async () => 'chat',
      complete: async () => { sends++; return { text: 'answer' }; },
    }),
  });
  assert.equal((await session.complete({ prompt: 'hello' })).text, 'answer');
  assert.equal(reconnects, 1);
  assert.equal(sends, 1);
});

test('expired Qwen session starts visible reconnect after releasing the account lease', async () => {
  const accounts = [{ id: 'a', token: 'old' }];
  const pool = createProviderAccountPool();
  pool.register('qwen', { listAccounts: () => accounts });
  const reconnects = [];
  const session = createQwenAccountSession({ pool, affinityKey: 'chat',
    refreshAccount: async account => account,
    markInvalid: id => { accounts.find(account => account.id === id).invalid = true; },
    onLoginRequired: async accountId => {
      assert.equal((await pool.snapshot('qwen')).find(account => account.id === accountId).busy, false);
      reconnects.push(accountId);
    },
    buildClient: async () => ({
      createChat: async () => 'chat',
      complete: async () => { throw Object.assign(new Error('Token has expired'), { isQwenSessionExpired: true }); },
    }),
  });
  await assert.rejects(session.complete({ prompt: 'hello' }), { code: 'QWEN_LOGIN_REQUIRED' });
  assert.deepEqual(reconnects, ['a']);
});

test('Qwen retries a rejected expired-token request after visible reconnect succeeds', async () => {
  const accounts = [{ id: 'a', token: 'old' }];
  const pool = createProviderAccountPool();
  pool.register('qwen', { listAccounts: () => accounts });
  const used = [];
  let reconnects = 0;
  const session = createQwenAccountSession({ pool, affinityKey: 'chat',
    refreshAccount: async account => account,
    markInvalid: id => { accounts.find(account => account.id === id).invalid = true; },
    onLoginRequired: async () => {
      reconnects++;
      accounts[0].token = 'fresh';
      accounts[0].invalid = false;
      return true;
    },
    buildClient: async account => ({
      createChat: async () => 'chat',
      complete: async () => {
        used.push(account.token);
        if (account.token === 'old') throw Object.assign(new Error('Token has expired'), { isQwenSessionExpired: true });
        return { text: 'answer' };
      },
    }),
  });
  assert.equal((await session.complete({ prompt: 'hello' })).text, 'answer');
  assert.deepEqual(used, ['old', 'fresh']);
  assert.equal(reconnects, 1);
  assert.equal(accounts[0].invalid, false);
});

test('a chat can recover through another browser profile of the same Qwen identity without a handoff', async () => {
  const accounts = [{ id: 'old', invalid: true }, { id: 'same-user' }];
  const pool = createProviderAccountPool();
  pool.register('qwen', { listAccounts: () => accounts });
  const sent = [], switches = [], sessions = [];
  const session = createQwenAccountSession({ pool, affinityKey: 'chat',
    initial: { accountId: 'old', chatId: 'existing-chat' },
    recoverUnavailable: async () => {},
    sameAccountIdentity: (oldId, account) => oldId === 'old' && account.id === 'same-user',
    onSwitch: event => switches.push(event),
    onSession: value => sessions.push(value),
    buildClient: async () => ({ createChat: async () => { throw new Error('must reuse existing chat'); }, complete: async options => { sent.push(options); return { text: 'ok' }; } }),
  });
  assert.equal((await session.complete({ prompt: 'hello', parentId: 'prior-message' })).text, 'ok');
  assert.equal(sent[0].chatId, 'existing-chat');
  assert.equal(sent[0].prompt, 'hello');
  assert.equal(sent[0].parentId, 'prior-message');
  assert.deepEqual(switches, []);
  assert.equal(sessions.at(-1).accountId, 'same-user');
});

test('an attested empty-root native chat id is persisted before a failed stream is rethrown', async () => {
  const accounts = [{ id: 'a' }];
  const pool = createProviderAccountPool(); pool.register('qwen', { listAccounts: () => accounts });
  const sessions = [], sent = [];
  const streamError = Object.assign(new Error('native stream interrupted'), {
    delivery: 'unknown',
    qwenNativeBootstrap: { previousChatId: 'api-empty-chat', chatId: 'native-chat' },
  });
  let first = true;
  const session = createQwenAccountSession({ pool, affinityKey: 'native-bootstrap',
    initial: { accountId: 'a', chatId: 'api-empty-chat' },
    onSession: value => sessions.push(value),
    buildClient: async () => ({
      async complete(options) {
        sent.push(options);
        if (first) { first = false; throw streamError; }
        return { text: 'continued' };
      },
    }),
  });
  await assert.rejects(session.complete({ prompt: 'first turn', parentId: null }), error => error === streamError);
  assert.deepEqual(sessions.map(value => value.chatId), ['api-empty-chat', 'native-chat']);
  const continued = await session.complete({ prompt: 'continue', parentId: null });
  assert.equal(continued.text, 'continued');
  assert.equal(sent[1].chatId, 'native-chat');
});

test('native bootstrap marker cannot retarget an explicit parent or a different previous chat', async t => {
  const cases = [
    { name: 'explicit parent', parentId: 'existing-parent', previousChatId: 'api-empty-chat' },
    { name: 'previous chat mismatch', parentId: null, previousChatId: 'another-chat' },
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const pool = createProviderAccountPool(); pool.register('qwen', { listAccounts: () => [{ id: 'a' }] });
    const sessions = [];
    const failure = Object.assign(new Error('native stream interrupted'), {
      delivery: 'unknown',
      qwenNativeBootstrap: { previousChatId: item.previousChatId, chatId: 'native-chat' },
    });
    const session = createQwenAccountSession({ pool, affinityKey: `invalid-bootstrap-${item.name}`,
      initial: { accountId: 'a', chatId: 'api-empty-chat' },
      onSession: value => sessions.push(value),
      buildClient: async () => ({ complete: async () => { throw failure; } }),
    });
    await assert.rejects(session.complete({ prompt: 'first turn', parentId: item.parentId }), error => error === failure);
    assert.deepEqual(sessions.map(value => value.chatId), ['api-empty-chat']);
  });
});

test('successful provider recoveredChatId still updates and returns the persisted session id', async () => {
  const pool = createProviderAccountPool(); pool.register('qwen', { listAccounts: () => [{ id: 'a' }] });
  const sessions = [];
  const session = createQwenAccountSession({ pool, affinityKey: 'existing-recovered-chat',
    initial: { accountId: 'a', chatId: 'original-chat' },
    onSession: value => sessions.push(value),
    buildClient: async () => ({ complete: async () => ({ text: 'answer', recoveredChatId: 'provider-recovered-chat' }) }),
  });
  const result = await session.complete({ prompt: 'continue', parentId: 'prior' });
  assert.equal(result.recoveredChatId, 'provider-recovered-chat');
  assert.equal(sessions.at(-1).chatId, 'provider-recovered-chat');
});

test('quota classifier marks only explicit exhausted quota, not temporary 429 limits', () => {
  assert.equal(qwenQuotaError(200, '{"error":{"code":"quota_exceeded"}}')?.code, 'QWEN_QUOTA_EXHAUSTED');
  assert.equal(qwenQuotaError(429, { error: { code: 'quota_exceeded' } })?.code, 'QWEN_QUOTA_EXHAUSTED');
  for (const [status, text] of [[429,''],[429,{ error: { code: 'too_many_requests' } }],[429,'{"error":{"code":"rate_limit_exceeded"}}'],[200,'rate limit exceeded'],[403,'Forbidden'],[429,'<html>captcha</html>'],[200,'{"error":{"code":"context_length_exceeded"}}'],[200,'{"error":{"code":"Bad_Request","message":"Internal error"}}']]) {
    assert.equal(qwenQuotaError(status,text), null);
  }
});

test('real code loop writes once, changes account after quota, then finishes with checkpoint', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-handoff-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const accounts = [{ id: 'a' }, { id: 'b' }];
  const pool = createProviderAccountPool(); pool.register('qwen', { listAccounts: () => accounts });
  let requests = 0, toolExecutions = 0, checkpoint;
  const session = createQwenAccountSession({ pool, affinityKey: 'code', context: () => JSON.stringify(checkpoint),
    markLimited: id => { accounts.find(a => a.id === id).limited = true; },
    buildClient: async account => ({ createChat: async () => account.id,
      complete: async options => {
        requests++;
        if (requests === 1) return { text: JSON.stringify({ tool: 'write_file', path: 'result.txt', content: 'once' }), lastMessageId: 'p1' };
        if (account.id === 'a') throw Object.assign(new Error('quota'), { code: 'QWEN_QUOTA_EXHAUSTED' });
        assert.match(options.prompt, /result.txt/);
        assert.match(options.prompt, /do not repeat/i);
        return { text: JSON.stringify({ tool: 'finish', message: 'Done' }), lastMessageId: 'p2' };
      },
    }),
  });
  const result = await runCodeTask(createQwenAgentAdapter(session), {}, directory, 'Write result.txt once', null, {
    memoryEnabled: false, maxToolSteps: 4,
    onCheckpoint: value => { checkpoint = value; },
    onTool: call => { if (call.tool === 'write_file') toolExecutions++; },
  });
  assert.equal(fs.readFileSync(path.join(directory, 'result.txt'), 'utf8'), 'once');
  assert.equal(toolExecutions, 1);
  assert.equal(requests, 3);
  assert.equal(result.message, 'Done');
});

test('paused non-native loop resumes its pending request and keeps executed tool history', async () => {
  let prompt;
  const result = await runCodeTask({ complete: async options => { prompt = options.prompt; return { text: '{"tool":"finish","message":"resumed"}' }; } }, {}, process.cwd(), 'original', null, {
    memoryEnabled: false, resumeState: { prompt: 'Saved tool result', toolLogs: ['write_file already done'], parentMessageId: 'p1' },
  });
  assert.equal(prompt, 'Saved tool result');
  assert.deepEqual(result.toolLogs, ['write_file already done']);
});

test('quota refreshes the same account once before marking it limited', async () => {
  const accounts = [{ id: 'a', token: 'old-token', profileDir: '/tmp/qwen-a' }, { id: 'b', token: 'reserve-token' }];
  const pool = createProviderAccountPool();
  pool.register('qwen', { listAccounts: () => accounts });
  const calls = [];
  const refreshed = [];
  const limited = [];
  const session = createQwenAccountSession({
    pool,
    affinityKey: 'chat',
    markLimited: id => { limited.push(id); accounts.find(a => a.id === id).limited = true; },
    refreshAccount: async account => {
      refreshed.push(account.id);
      const current = accounts.find(a => a.id === account.id);
      Object.assign(current, { token: 'fresh-token', cookieHeader: 'token=fresh-token', limited: false, invalid: false });
      return current;
    },
    buildClient: async account => ({
      createChat: async () => account.id + '-chat',
      complete: async options => {
        calls.push({ account: account.id, token: account.token, ...options });
        if (account.id === 'a' && account.token === 'old-token') {
          throw Object.assign(new Error('limit'), { code: 'QWEN_QUOTA_EXHAUSTED' });
        }
        return { text: 'done', lastMessageId: account.id + '-parent' };
      },
    }),
  });

  const result = await session.complete({ prompt: 'task' });
  assert.equal(result.text, 'done');
  assert.deepEqual(refreshed, ['a']);
  assert.deepEqual(limited, []);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].account, 'a');
  assert.equal(calls[0].token, 'old-token');
  assert.equal(calls[1].account, 'a');
  assert.equal(calls[1].token, 'fresh-token');
  assert.notEqual(accounts[0].limited, true);
});
