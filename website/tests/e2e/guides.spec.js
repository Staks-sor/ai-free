import { expect, test } from '@playwright/test';

test('AI guides are discoverable, readable and have unique search metadata', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#guides .guide-card')).toHaveCount(3);
  const titles = new Set();
  for (const slug of ['ai-for-coding', 'ai-agent-team', 'ai-vscode-pycharm']) {
    await page.goto(`/guides/${slug}/`);
    titles.add(await page.title());
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://synvox.pro/guides/${slug}/`);
    await page.locator('.guide-question summary').first().click();
    await expect(page.locator('.guide-question p').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.guide-section p').first().evaluate(el => parseFloat(getComputedStyle(el).lineHeight))).toBeGreaterThan(20);
    await page.screenshot({ path: testInfo.outputPath(`${slug}.png`), fullPage: true });
  }
  expect(titles.size).toBe(3);
});
