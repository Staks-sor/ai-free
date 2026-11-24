import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('home search titles explain the product category in each language', async () => {
  for (const [path, title] of [
    ['../src/routes/+page.svelte', 'SYNVOX — AI-помощник для программирования'],
    ['../src/routes/en/+page.svelte', 'SYNVOX — AI coding assistant for your project'],
  ]) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.ok(source.includes(`<title>${title}</title>`), path);
    assert.ok(source.includes(`property="og:title" content="${title}"`), path);
    assert.ok(source.includes(`name="twitter:title" content="${title}"`), path);
  }
});
