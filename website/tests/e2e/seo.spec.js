import { expect, test } from '@playwright/test';

test('search engines receive valid product JSON-LD and verification tags', async ({ page }) => {
  await page.goto('/');
  const schema = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '');
  expect(schema['@type']).toBe('SoftwareApplication');
  expect(schema.name).toBe('SYNVOX');
  expect(schema.url).toBe('https://synvox.pro');
  for (const name of ['google-site-verification', 'msvalidate.01']) {
    await expect(page.locator(`meta[name="${name}"]`)).toHaveAttribute('content', /\S+/);
  }
});

test('every public page has share metadata and an absolute canonical URL', async ({ page }) => {
  for (const path of ['/', '/updates/', '/documents/']) {
    await page.goto(path);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://synvox.pro${path}`);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /SYNVOX/);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', /\S+/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://synvox.pro/images/og-synvox.jpg');
  }
});
