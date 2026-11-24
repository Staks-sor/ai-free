import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommercialContent } from '../src/lib/content/commercial.js';

test('historical commercial terms remain available for earlier payments', () => {
  const content = createCommercialContent();
  assert.equal(content.priceRub, 99);
  assert.equal(content.periodDays, 30);
  assert.equal(content.trialDays, 3);
  assert.equal(content.internationalEur, '1,30');
  const offer = content.legal.docs.find(doc => doc.id === 'offer');
  assert.match(JSON.stringify(offer), /99 рублей за 30/);
  assert.doesNotMatch(JSON.stringify(offer), /100 рублей|не менее чем за 3 дня/);
  assert.equal(content.ready, true);
  assert.equal(createCommercialContent({ PUBLIC_SYNVOX_LEGAL_ADDRESS: '' }).ready, false);
  assert.equal(content.email, 'stas.sor@gmail.com');
});

test('public environment settings fill every legal document and support link', () => {
  const content = createCommercialContent({
    PUBLIC_SYNVOX_LEGAL_NAME: 'Тестовый продавец', PUBLIC_SYNVOX_LEGAL_STATUS: 'ИП',
    PUBLIC_SYNVOX_LEGAL_INN: '123456789012', PUBLIC_SYNVOX_LEGAL_OGRN: '123456789012345',
    PUBLIC_SYNVOX_LEGAL_ADDRESS: 'Тестовый адрес', PUBLIC_SYNVOX_LEGAL_EMAIL: 'support@example.com',
  });
  assert.equal(content.ready, true);
  assert.equal(content.email, 'support@example.com');
  assert.doesNotMatch(JSON.stringify(content.legal), /\[УКАЖИТЕ|\[ИНН\]|\[email/);
});

test('self-employed seller does not need an invented OGRN, an individual entrepreneur does', () => {
  const env = { PUBLIC_SYNVOX_LEGAL_NAME: 'Тестовый продавец', PUBLIC_SYNVOX_LEGAL_STATUS: 'Самозанятый',
    PUBLIC_SYNVOX_LEGAL_INN: '123456789012', PUBLIC_SYNVOX_LEGAL_ADDRESS: 'Тестовый адрес',
    PUBLIC_SYNVOX_LEGAL_EMAIL: 'support@example.com' };
  assert.equal(createCommercialContent(env).ready, true);
  assert.equal(createCommercialContent({ ...env, PUBLIC_SYNVOX_LEGAL_STATUS: 'ИП на НПД' }).ready, false);
  assert.equal(createCommercialContent({ ...env, PUBLIC_SYNVOX_LEGAL_EMAIL: 'bad' }).ready, false);
});
