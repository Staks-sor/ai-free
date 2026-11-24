import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('public RU and EN pages offer SYNVOX free without payment acquisition', () => {
  for (const page of ['../src/routes/+page.svelte', '../src/routes/en/+page.svelte']) {
    const source = read(page);
    assert.doesNotMatch(source, /SubscriptionTerms/);
    assert.doesNotMatch(source, /99 ₽|99 RUB|100 Stars|Pricing|Тарифы/);
    assert.match(source, /Бесплатно|Free for personal use/);
  }
});

test('subscription endpoint advertises free access rather than a purchasable plan', () => {
  const config = JSON.parse(read('../static/api/v1/subscription/config.json'));
  assert.equal(config.paymentEnabled, false);
  assert.equal(config.paymentState, 'free');
  assert.equal(config.accessMode, 'free');
  assert.equal('priceRub' in config, false);
});

test('AI crawler guidance describes free personal use and has no purchase destination', () => {
  const guidance = read('../static/llms.txt');
  assert.match(guidance, /личного использования.*бесплатно/i);
  assert.doesNotMatch(guidance, /#pricing|99 рублей|Telegram Stars/i);
});
