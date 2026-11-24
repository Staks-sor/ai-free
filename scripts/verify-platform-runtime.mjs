// No desktop input or screenshot is performed by this dependency smoke check.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createCodeSystemPrompt } from '../src/code-agent/prompt.mjs';
const require = createRequire(import.meta.url);
assert.ok(Number(process.versions.node.split('.')[0]) >= 22, 'Node.js 22+ is required');
const robot = require('@jitsi/robotjs');
for (const name of ['getScreenSize', 'moveMouse', 'mouseClick', 'typeString', 'keyToggle', 'scrollMouse']) {
  assert.equal(typeof robot[name], 'function', `Native desktop runtime is missing ${name}`);
}
assert.equal(typeof robot.screen.capture, 'function');
for (const name of ['playwright', 'patchright']) assert.equal(typeof require(name).chromium.launch, 'function');
const prompt = createCodeSystemPrompt(process.cwd(), 'Inspect this project', '', { accessMode: 'computer' });
assert.ok(prompt.includes(process.platform));
assert.ok(prompt.includes(process.platform === 'win32' ? 'run_shell uses cmd.exe' : 'run_shell uses POSIX sh'));
console.log(`Runtime loaded: ${process.platform}/${process.arch}, Node ${process.versions.node}; desktop input not exercised.`);
