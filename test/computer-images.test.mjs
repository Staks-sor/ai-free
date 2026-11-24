import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareComputerScreenshot } from '../src/code-agent/computer-images.mjs';
import { createGoogleAIAgentAdapter } from '../src/providers/google-ai/agent-adapter.mjs';
import { isToolAllowed } from '../src/skills/permissions.mjs';

test('screenshots stay out of text and unsupported providers explicitly lack vision', () => {
  const snapshot = { ok: true, screenshot: { mime: 'image/png', base64: 'cGl4ZWxz', width: 2, height: 2, logicalWidth: 2, logicalHeight: 2 } };
  const delivered = prepareComputerScreenshot(snapshot, true);
  assert.equal(delivered.images[0].dataBase64, 'cGl4ZWxz');
  assert.equal(delivered.result.screenshot.imageDelivered, true);
  assert.equal(JSON.stringify(delivered.result).includes('cGl4ZWxz'), false);
  const unsupported = prepareComputerScreenshot(snapshot, false);
  assert.equal(unsupported.images.length, 0);
  assert.match(unsupported.result.visionUnavailable, /cannot receive desktop screenshots/);
  assert.equal(unsupported.result.screenshot.imageDelivered, false);
  assert.equal(snapshot.screenshot.base64, 'cGl4ZWxz');
});

test('desktop tools require computer access and still respect a restricted skill', () => {
  assert.equal(isToolAllowed('computer_click', null), false);
  assert.equal(isToolAllowed('computer_click', null, { accessMode: 'computer' }), true);
  assert.equal(isToolAllowed('computer_click', ['read_file'], { accessMode: 'computer' }), false);
});

test('Google AI attaches subsequent desktop images exactly once', async () => {
  const requests = [];
  const desktop = { name: 'desktop.png', mimeType: 'image/png', dataBase64: 'Ag==' };
  const adapter = createGoogleAIAgentAdapter({ async complete(request) { requests.push(request); return { text: 'ok' }; } });
  assert.equal(adapter.supportsImageAttachments, true);
  await adapter.complete({ prompt: 'desktop', images: [desktop] });
  await adapter.complete({ prompt: 'after' });
  assert.deepEqual(requests.map(request => request.images), [[desktop], []]);
});

test('image checkpoints keep private cache references and reject arbitrary file paths', async t => {
  const fs = await import('node:fs');
  const { cacheComputerImages, readComputerImages, removeComputerImages } = await import('../src/code-agent/computer-images.mjs');
  const image = { name: 'desktop.png', mimeType: 'image/png', dataBase64: 'cGl4ZWxz' };
  const references = cacheComputerImages([image]);
  t.after(() => removeComputerImages(references));
  assert.equal(JSON.stringify(references).includes(image.dataBase64), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(references[0].path).mode & 0o777, 0o600);
  assert.deepEqual(readComputerImages(references), [image]);
  assert.throws(() => readComputerImages([{ path: '/etc/passwd' }]), /Invalid desktop image checkpoint/);
});

test('image cache keeps the screenshot MIME extension', async t => {
  const fs = await import('node:fs');
  const { cacheComputerImages, readComputerImages, removeComputerImages } = await import('../src/code-agent/computer-images.mjs');
  const image = { name: 'browser.jpg', mimeType: 'image/jpeg', dataBase64: '/9j/' };
  const references = cacheComputerImages([image]);
  t.after(() => removeComputerImages(references));
  assert.match(references[0].path, /\.jpg$/);
  assert.deepEqual(readComputerImages(references), [image]);
  assert.equal(fs.existsSync(references[0].path), true);
});
