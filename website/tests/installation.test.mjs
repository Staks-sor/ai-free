import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
test('both languages expose installation and an actual Node archive', () => {
  for (const prefix of ['', 'en/']) {
    const page = read(`routes/${prefix}instructions/+page.svelte`);
    for (const command of ['node --version', 'npm ci', 'npm start']) assert.ok(page.includes(command));
    assert.ok(page.includes('/downloads/synvox-desktop-0.5.65.zip'));
    assert.ok(page.includes('Node.js 22'));
    assert.ok(read(`routes/${prefix}+page.svelte`).includes(`/${prefix}instructions/`));
  }
});
test('both installation guides explain the native desktop requirements and Wayland limit', () => {
  for (const prefix of ['', 'en/']) {
    const page = read(`routes/${prefix}instructions/+page.svelte`);
    for (const requirement of ['X11', 'Wayland', 'libxtst6', 'cmd.exe']) assert.ok(page.includes(requirement), requirement);
  }
});
