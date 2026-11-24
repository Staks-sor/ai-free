import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAnnouncements, normalizeAnnouncementFeed, ANNOUNCEMENTS_URL } from '../src/announcements/client.mjs';
import { createAnnouncementRoutes } from '../src/window-app/routes/announcements.mjs';
import { requiresDesktopLicense } from '../src/licensing/desktop-gate.mjs';
import { renderWindowHtml } from '../src/window-app/ui-html.mjs';

const timestamp = Date.parse('2026-11-17T12:00:00Z');
const item = (id = 'support-2026-11') => ({ id, publishedAt: '2026-11-17T00:00:00Z', expiresAt: '2026-12-17T00:00:00Z',
  title: { ru: 'Важное сообщение', en: 'Important notice' }, body: { ru: 'Напишите разработчику.', en: 'Contact the developer.' },
  link: { label: { ru: 'Написать', en: 'Contact' }, url: 'https://t.me/Staks_sor' } });
const feed = (...announcements) => ({ schemaVersion: 1, announcements });
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-announcements-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, 'read.jsonl');
  return { stateFile, client: createAnnouncements({ stateFile, now: () => timestamp,
    fetchImpl: async () => Response.json(feed(item())), ...options }) };
}

test('announcement feed accepts plain localized text and rejects executable links, duplicates and unbounded content', () => {
  assert.equal(normalizeAnnouncementFeed(feed(item()))[0].id, item().id);
  for (const url of ['javascript:alert(1)', 'https://evil.test/', 'https://synvox.pro.evil.test/', 'https://user@synvox.pro/', 'https://t.me:123/Staks_sor']) {
    assert.throws(() => normalizeAnnouncementFeed(feed({ ...item(), link: { ...item().link, url } })), /announcement/i);
  }
  assert.throws(() => normalizeAnnouncementFeed(feed(item(), item())), /announcement/i);
  assert.throws(() => normalizeAnnouncementFeed(feed({ ...item(), body: { ru: 'x'.repeat(8001) } })), /announcement/i);
  assert.throws(() => normalizeAnnouncementFeed(feed({ ...item(), expiresAt: '2026-01-01T00:00:00Z' })), /announcement/i);
  assert.throws(() => normalizeAnnouncementFeed({ schemaVersion: 2, announcements: [] }), /announcement/i);
});

test('fetch is public and bounded; simultaneous readers share one request and successful cache', async t => {
  let calls = 0;
  const { client } = fixture(t, { fetchImpl: async (url, options) => {
    calls++; assert.equal(url, ANNOUNCEMENTS_URL); assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit'); assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.body, undefined); assert.ok(options.signal);
    return Response.json(feed(item()));
  } });
  const [a, b] = await Promise.all([client.list(), client.list()]);
  assert.equal(calls, 1); assert.deepEqual(a, b); assert.equal(a.announcements[0].seen, false);
  await client.list(); assert.equal(calls, 1);
});

test('acknowledgements survive a backend restart and merge across clients without touching chat or license state', async t => {
  const two = feed(item('first'), item('second'));
  const { stateFile, client } = fixture(t, { fetchImpl: async () => Response.json(two) });
  const other = createAnnouncements({ stateFile, now: () => timestamp, fetchImpl: async () => Response.json(two) });
  await Promise.all([client.list(), other.list()]);
  await Promise.all([client.acknowledge(['first']), other.acknowledge(['second'])]);
  const restarted = createAnnouncements({ stateFile, now: () => timestamp, fetchImpl: async () => Response.json(two) });
  assert.ok((await restarted.list()).announcements.every(a => a.seen));
  assert.throws(() => client.acknowledge(['bad\nidentifier']), /announcement/i);
  assert.equal(fs.readdirSync(path.dirname(stateFile)).length, 1);
});

test('a displayed notice can be dismissed after its expiry or removal from the feed', async t => {
  let clock = timestamp;
  const { client } = fixture(t, { now: () => clock });
  await client.list(); clock = Date.parse('2027-01-01T00:00:00Z');
  await client.list();
  assert.deepEqual(client.acknowledge([item().id]), { ok: true });
});

test('offline and invalid feed preserve good cached notices, suppress expired/future ones and do not acknowledge new IDs', async t => {
  let clock = timestamp, fail = false;
  const { client } = fixture(t, { now: () => clock, fetchImpl: async () => {
    if (fail) throw Error('offline');
    return Response.json(feed(item(), { ...item('future'), publishedAt: '2026-12-01T00:00:00Z' }));
  } });
  assert.equal((await client.list()).announcements.length, 1);
  fail = true; clock += 6 * 60_000;
  const cached = await client.list(); assert.equal(cached.stale, true); assert.equal(cached.announcements.length, 1);
  clock = Date.parse('2027-01-01T00:00:00Z'); assert.deepEqual((await client.list()).announcements, []);
  const cold = fixture(t, { fetchImpl: async () => new Response('x'.repeat(131073)) }).client;
  assert.deepEqual((await cold.list()).announcements, []);
  assert.equal((await cold.list()).stale, true);
});

test('a new server notice arrives after the refresh interval; malformed refresh keeps the previous feed', async t => {
  let clock = timestamp, data = feed(item('first'));
  const { client } = fixture(t, { now: () => clock, fetchImpl: async () => Response.json(data) });
  await client.list(); client.acknowledge(['first']);
  data = feed(item('first'), item('second'));
  assert.equal((await client.list()).announcements.length, 1);
  clock += 5 * 60_000;
  const next = await client.list();
  assert.equal(next.announcements.find(a => a.id === 'first').seen, true);
  assert.equal(next.announcements.find(a => a.id === 'second').seen, false);
  data = { schemaVersion: 2 }; clock += 5 * 60_000;
  const kept = await client.list(); assert.equal(kept.stale, true); assert.equal(kept.announcements.length, 2);
});

test('failed local acknowledgement is reported as a failure, never as successful dismissal', async t => {
  const { stateFile, client } = fixture(t);
  await client.list(); fs.mkdirSync(stateFile);
  const route = createAnnouncementRoutes({ client });
  let status, response;
  await route({ method: 'POST' }, {}, new URL('http://localhost/api/announcements/read'), {
    readBody: async () => ({ ids: [item().id] }), sendJson: (_res, data, code) => { status = code; response = data; },
  });
  assert.equal(status, 400); assert.ok(response.error); assert.notEqual(response.ok, true);
});

test('announcement read and acknowledgement routes work without a subscription and persist only explicit dismissals', async t => {
  const { client } = fixture(t);
  const route = createAnnouncementRoutes({ client });
  let value, status;
  const helpers = { sendJson: (_res, data, code = 200) => { value = data; status = code; }, readBody: async () => ({ ids: [item().id] }) };
  const url = new URL('http://localhost/api/announcements');
  assert.equal(await route({ method: 'GET' }, {}, url, helpers), true);
  assert.equal(value.announcements[0].seen, false);
  assert.equal(requiresDesktopLicense('POST', '/api/announcements/read'), false);
  assert.equal(requiresDesktopLicense('POST', '/api/announcements/anything-else'), false);
  await route({ method: 'POST' }, {}, new URL('/api/announcements/read', url), helpers);
  assert.equal(status, 200); assert.equal(value.ok, true);
  assert.ok((await client.list()).announcements[0].seen);
  assert.equal(await route({ method: 'GET' }, {}, new URL('/other', url), helpers), false);
});

test('shared HTML includes the same compact announcements control and safely rendered localized dialog', () => {
  for (const language of ['ru', 'en']) {
    const html = renderWindowHtml({ language });
    assert.match(html, /id="announcementsButton"/);
    assert.match(html, /setupAnnouncementsUi/);
    assert.match(html, /\/api\/announcements/);
    assert.match(html, /announcement\.title/);
    assert.match(html, /\.textContent =/);
    assert.match(html, /announcementsUi\.start\(\)/);
  }
  for (const file of ['announcements/client.mjs', 'window-app/announcements-ui.mjs', 'window-app/routes/announcements.mjs']) {
    assert.equal(fs.readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'),
      fs.readFileSync(new URL('../plugin-for-vscode/src/' + file, import.meta.url), 'utf8'));
  }
  const published = JSON.parse(fs.readFileSync(new URL('../website/static/api/v1/announcements.json', import.meta.url)));
  assert.ok(normalizeAnnouncementFeed(published).length);
});
