import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { guides } from '../src/lib/content/guides.js';
import { englishGuides } from '../src/lib/content/guides-en.js';

test('AI guides answer distinct product questions and are in the sitemap', async () => {
  assert.equal(guides.length, 3);
  assert.equal(new Set(guides.map((guide) => guide.title)).size, 3);
  const sitemap = await readFile(new URL('../static/sitemap.xml', import.meta.url), 'utf8');
  for (const guide of guides) {
    assert.ok(guide.description.length > 60 && guide.description.length < 180);
    assert.ok(guide.sections.length >= 3);
    assert.ok(guide.example.length > 80);
    assert.ok(guide.questions.length >= 2);
    assert.ok(sitemap.includes(`https://synvox.pro/guides/${guide.slug}/`));
  }
});

test('IDE guide describes the published manual desktop download in both languages', () => {
  const ruSection = guides.find((guide) => guide.slug === 'ai-vscode-pycharm')
    .sections.find((section) => section.title === 'Как отличаются плагины и десктоп');
  const enSection = englishGuides.find((guide) => guide.slug === 'ai-vscode-pycharm')
    .sections.find((section) => section.title === 'How plugins differ from desktop');

  assert.match(ruSection.text, /0\.5\.65/);
  assert.match(ruSection.text, /ZIP/);
  assert.doesNotMatch(ruSection.text, /готовится/);
  assert.match(enSection.text, /0\.5\.65/);
  assert.match(enSection.text, /ZIP/);
  assert.doesNotMatch(enSection.text, /not available yet/);
});
