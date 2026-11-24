import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeWorkspaceTool } from '../src/code-agent/executor.mjs';
import { readSkillResource } from '../src/skills/resources.mjs';

test('skill catalog contains metadata without full instructions and activates only the selected skill', async () => {
  const catalog = await executeWorkspaceTool(process.cwd(), { tool: 'list_skills' });
  assert.equal(catalog.ok, true);
  assert.ok(catalog.skills.length <= 20);
  assert.ok(catalog.skills.some(skill => skill.id === 'bug-fix'));
  assert.ok(catalog.skills.every(skill => !('prompt' in skill)));
  const activated = await executeWorkspaceTool(process.cwd(), { tool: 'load_skill', id: 'bug-fix' });
  assert.ok(activated.instructions.length > 0);
  assert.match(activated.notice, /permissions/i);
  await assert.rejects(executeWorkspaceTool(process.cwd(), { tool: 'load_skill', id: '../../private' }), /invalid/i);
});

test('skill resources are bounded and cannot traverse or escape through symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-skill-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-skill-outside-'));
  try {
    fs.mkdirSync(path.join(root, 'references'));
    fs.writeFileSync(path.join(root, 'references/guide.md'), 'x'.repeat(100_000));
    fs.writeFileSync(path.join(outside, 'private.txt'), 'private');
    fs.symlinkSync(path.join(outside, 'private.txt'), path.join(root, 'references/escape.md'));
    const loaded = readSkillResource({ source: root }, 'references/guide.md');
    assert.ok(loaded.content.length <= 16_384);
    assert.equal(loaded.truncated, true);
    assert.throws(() => readSkillResource({ source: root }, '../private.txt'), /outside/i);
    assert.throws(() => readSkillResource({ source: root }, '..'), /outside/i);
    assert.throws(() => readSkillResource({ source: root }, 'references/escape.md'), /outside/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('skill discovery does not expand executable permissions or browser-only access', async () => {
  const { isToolAllowed } = await import('../src/skills/permissions.mjs');
  assert.equal(isToolAllowed('list_skills', ['read_file']), true);
  assert.equal(isToolAllowed('load_skill', ['read_file']), true);
  assert.equal(isToolAllowed('verify_task', ['run_command']), true);
  assert.equal(isToolAllowed('verify_task', ['read_file']), false);
  assert.equal(isToolAllowed('load_skill', ['browser_snapshot']), false);
  assert.equal(isToolAllowed('run_shell', ['read_file']), false);
});

test('metadata discovery skips native prompt files and reads only a bounded SKILL.md header', async () => {
  const { loadSkillFromDir } = await import('../src/skills/loader.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-skill-metadata-'));
  const original = fs.readFileSync;
  try {
    fs.writeFileSync(path.join(root, 'skill.json'), JSON.stringify({ id: 'test', description: 'Metadata', promptFile: 'prompt.md' }));
    fs.writeFileSync(path.join(root, 'prompt.md'), 'huge instructions');
    fs.readFileSync = function(file, ...args) {
      if (file === path.join(root, 'prompt.md') || file === path.join(root, 'SKILL.md')) throw new Error('eager prompt read');
      return original.call(this, file, ...args);
    };
    const native = loadSkillFromDir(root, 'test', { metadataOnly: true });
    assert.equal(native.description, 'Metadata');
    assert.equal(native.prompt, '');
    fs.unlinkSync(path.join(root, 'skill.json'));
    fs.writeFileSync(path.join(root, 'SKILL.md'), '---\nname: Test\ndescription: Metadata\n---\n' + 'x'.repeat(500_000));
    const md = loadSkillFromDir(root, 'test', { metadataOnly: true });
    assert.equal(md.description, 'Metadata');
    assert.equal(md.prompt, '');
  } finally { fs.readFileSync = original; fs.rmSync(root, { recursive: true, force: true }); }
});
