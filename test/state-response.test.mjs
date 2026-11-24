import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendSavedJson, endSavedNdjsonStream } from '../src/window-app/http.mjs';

test('success responses wait for saved state and conflicts return 409', async () => {
  const events = [], res = { writeHead: status => events.push(status), end: body => events.push(JSON.parse(body)) };
  let release;
  const sending = sendSavedJson({ flush: () => new Promise(resolve => { release = resolve; }) }, res, { ok: true });
  assert.deepEqual(events, []); release(); await sending;
  assert.deepEqual(events, [200, { ok: true }]);
  events.length = 0;
  await sendSavedJson({ flush: async () => { throw Object.assign(new Error('conflict'), { code: 'STATE_CONFLICT' }); } }, res, { ok: true });
  assert.equal(events[0], 409); assert.equal(events[1].code, 'STATE_CONFLICT');
});

test('a stream reports persistence failure before it closes', async () => {
  const events = [], res = { write: line => events.push(JSON.parse(line)), end: () => events.push('end') };
  await endSavedNdjsonStream({ flush: async () => { throw new Error('disk full'); } }, res);
  assert.equal(events[0].type, 'error'); assert.equal(events[0].message, 'disk full'); assert.equal(events[1], 'end');
});
