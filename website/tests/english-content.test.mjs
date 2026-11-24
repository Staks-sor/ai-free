import assert from 'node:assert/strict';
import test from 'node:test';
import { createEnglishCommercialContent } from '../src/lib/content/commercial-en.js';
import { englishGuides } from '../src/lib/content/guides-en.js';
import { englishSite } from '../src/lib/content/site-en.js';

test('English legal archive and guides remain available', () => {
  const commercial = createEnglishCommercialContent();
  assert.equal(commercial.priceRub, 99);
  assert.equal(commercial.periodDays, 30);
  assert.equal(commercial.trialDays, 3);
  assert.equal(commercial.ready, true);
  assert.equal(englishGuides.length, 3);
  assert.ok(englishGuides.every((guide) => guide.sections.length >= 3 && guide.questions.length >= 2));
  assert.match(JSON.stringify(commercial.legal.docs), /Russian original prevails/);
  assert.equal(englishSite.primaryCta.href, '#download');
});
