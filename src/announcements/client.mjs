import fs from 'node:fs';
import path from 'node:path';
import { AUTH_DIR } from '../config.mjs';

export const ANNOUNCEMENTS_URL = 'https://synvox.pro/api/v1/announcements.json';
const MAX_BYTES = 131072;
const POLL_MS = 5 * 60_000;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value);
const invalid = () => { throw new Error('Invalid announcement'); };
function localized(value, limit) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = {};
  for (const lang of ['ru', 'en']) {
    if (value[lang] === undefined) continue;
    if (typeof value[lang] !== 'string' || !value[lang].trim() || value[lang].length > limit) invalid();
    result[lang] = value[lang].trim();
  }
  if (!Object.keys(result).length) invalid();
  return result;
}

export function normalizeAnnouncementFeed(feed) {
  if (feed?.schemaVersion !== 1 || !Array.isArray(feed.announcements) || feed.announcements.length > 20) invalid();
  const ids = new Set();
  return feed.announcements.map(value => {
    if (!validId(value?.id) || ids.has(value.id)) invalid();
    ids.add(value.id);
    for (const date of [value.publishedAt, value.expiresAt]) {
      if (typeof date !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(date) || !Number.isFinite(Date.parse(date))) invalid();
    }
    if (Date.parse(value.expiresAt) <= Date.parse(value.publishedAt)) invalid();
    const announcement = { id: value.id, publishedAt: value.publishedAt, expiresAt: value.expiresAt,
      title: localized(value.title, 200), body: localized(value.body, 8000) };
    if (value.link != null) {
      let url;
      try { url = new URL(value.link.url); } catch { invalid(); }
      if (url.protocol !== 'https:' || url.username || url.password || url.port || value.link.url.length > 1000
        || !['synvox.pro', 't.me'].includes(url.hostname)) invalid();
      announcement.link = { label: localized(value.link.label, 80), url: url.href };
    }
    return announcement;
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

// Public, read-only feed: never send installation IDs, keys or diagnostics to the site.
export function createAnnouncements({ fetchImpl = fetch, now = Date.now,
  stateFile = path.join(AUTH_DIR, 'announcements-read.jsonl') } = {}) {
  let cached = [], nextFetchAt = 0, pending, stale = true;
  function readIds() {
    try {
      // A short append-only acknowledgement avoids lost updates across IDE backends.
      const fd = fs.openSync(stateFile, 'r');
      try {
        const size = fs.fstatSync(fd).size, bytes = Buffer.alloc(Math.min(size, 1024 * 1024));
        fs.readSync(fd, bytes, 0, bytes.length, Math.max(0, size - bytes.length));
        return new Set(bytes.toString('utf8').split('\n').filter(validId));
      } finally { fs.closeSync(fd); }
    } catch (error) { if (error.code === 'ENOENT') return new Set(); throw error; }
  }
  function active() {
    const time = now();
    return cached.filter(a => Date.parse(a.publishedAt) <= time && time < Date.parse(a.expiresAt));
  }
  async function refresh() {
    try {
      const response = await fetchImpl(ANNOUNCEMENTS_URL, { redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw Error('Unavailable');
      let size = 0; const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_BYTES) throw Error('Feed too large');
        chunks.push(chunk);
      }
      cached = normalizeAnnouncementFeed(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      stale = false; nextFetchAt = now() + POLL_MS;
    } catch { stale = true; nextFetchAt = now() + 60_000; }
  }
  return {
    async list() {
      if (now() >= nextFetchAt) {
        if (!pending) pending = refresh().finally(() => { pending = null; });
        await pending;
      }
      const read = readIds();
      return { announcements: active().map(a => ({ ...a, seen: read.has(a.id) })), stale };
    },
    acknowledge(ids) {
      // A notice already on screen may have expired/been withdrawn during polling.
      if (!Array.isArray(ids) || !ids.length || ids.length > 20 || ids.some(id => !validId(id))) invalid();
      const read = readIds(), fresh = [...new Set(ids)].filter(id => !read.has(id));
      if (fresh.length) {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
        const fd = fs.openSync(stateFile, 'a', 0o600);
        try { fs.writeSync(fd, fresh.join('\n') + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      }
      return { ok: true };
    },
  };
}
