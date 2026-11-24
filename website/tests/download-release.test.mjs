import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('RU and EN download pages link to the 0.5.65 desktop archive', () => {
  for (const page of ['+page.svelte','en/+page.svelte','instructions/+page.svelte','en/instructions/+page.svelte']) {
    const text=fs.readFileSync(new URL('../src/routes/'+page,import.meta.url),'utf8');
    assert.ok(text.includes('/downloads/synvox-desktop-0.5.65.zip'),page);
    assert.ok(!text.includes('/downloads/synvox-desktop-preview.zip'),page);
  }
});

test('RU and EN download pages link to versioned IDE plugin packages', () => {
  for (const page of ['+page.svelte', 'en/+page.svelte']) {
    const text = fs.readFileSync(new URL('../src/routes/' + page, import.meta.url), 'utf8');
    assert.ok(text.includes('/downloads/synvox-vscode-0.5.65.vsix'), page);
    assert.ok(text.includes('/downloads/synvox-jetbrains-0.5.65.zip'), page);
  }
});

test('download actions have room above the platform list', () => {
  const css = fs.readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.download-inner > \.guide-actions\s*\{[^}]*margin-top:\s*16px;[^}]*margin-bottom:\s*24px;/);
});


test('current release and installation requirements agree in both languages', async () => {
  const {releaseState}=await import('../src/lib/content/site.js');
  const {englishReleaseState}=await import('../src/lib/content/site-en.js');
  for(const release of [releaseState,englishReleaseState]) {
    assert.ok(release.label.includes('0.5.65'));
    assert.match(release.message,/Node\.js 22\+/);
  }
  for(const prefix of ['', 'en/']) {
    const guide=fs.readFileSync(new URL('../src/routes/'+prefix+'instructions/+page.svelte',import.meta.url),'utf8');
    assert.ok(guide.includes('Python 3.10+'));
    assert.ok(guide.includes('0.5.65'));
    const updates=fs.readFileSync(new URL('../src/routes/'+prefix+'updates/+page.svelte',import.meta.url),'utf8');
    assert.ok(updates.includes('ALPHA · 0.5.65'));
  }
});
