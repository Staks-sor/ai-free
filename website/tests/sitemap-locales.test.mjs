import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { guides } from '../src/lib/content/guides.js';
import { englishGuides } from '../src/lib/content/guides-en.js';

test('sitemap covers all public RU/EN pages with reciprocal language alternatives', async () => {
  const xml = await readFile(new URL('../static/sitemap.xml', import.meta.url), 'utf8');
  assert.match(xml, /xmlns:xhtml="http:\/\/www.w3.org\/1999\/xhtml"/);
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(match => match[1]);
  const paths = ['/', '/updates/', '/documents/', '/instructions/', ...guides.map(guide => `/guides/${guide.slug}/`)];
  assert.deepEqual(englishGuides.map(guide => guide.slug), guides.map(guide => guide.slug));
  assert.equal(entries.length, paths.length * 2);
  const locations = entries.map(entry => entry.match(/<loc>(.*?)<\/loc>/)?.[1]);
  assert.equal(new Set(locations).size, entries.length);
  for (const path of paths) {
    const ru = `https://synvox.pro${path}`;
    const en = `https://synvox.pro/en${path}`;
    for (const location of [ru, en]) {
      const entry = entries.find(item => item.includes(`<loc>${location}</loc>`));
      assert.ok(entry, `Missing ${location}`);
      assert.ok(entry.includes(`hreflang="ru" href="${ru}"`));
      assert.ok(entry.includes(`hreflang="en" href="${en}"`));
    }
  }
});
