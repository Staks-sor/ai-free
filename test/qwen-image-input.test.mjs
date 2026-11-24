import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as composer from '../src/providers/qwen/native-composer.mjs';
import { createQwenAgentAdapter, createQwenAgentTransport } from '../src/providers/qwen/agent-adapter.mjs';

const image = { name: 'test.png', mimeType: 'image/png', dataBase64: 'AQ==' };
function uploadPage({ failed = false, pending = false, rejectChooser = null, abortOnSetFiles = null, russian = false } = {}) {
  const selected = [], clicks = [];
  const preview = { classList: { contains: name => failed && name === 'vision-item-container-error' },
    querySelector: () => pending ? null : { complete: true, naturalWidth: 10, getAttribute: () => 'https://uploads.example/test.png' } };
  return { selected, clicks,
    getByRole(role, options) {
      if (role === 'button' && options.name instanceof RegExp && options.name.test('Select Mode')) return {
        click: async () => { clicks.push('select-mode'); },
      };
      if (role === 'menuitem' && options.name instanceof RegExp
        && options.name.test(russian ? 'Загрузить вложение\nФайл, изображение, видео, аудио' : 'Upload attachment file, image, video, audio')) return {
        waitFor: async () => {},
        click: async () => { clicks.push('upload'); },
      };
      throw new Error(`Unexpected role ${role}`);
    },
    waitForEvent: () => rejectChooser ? Promise.reject(rejectChooser) : Promise.resolve({
      setFiles: async files => { selected.push(files); abortOnSetFiles?.abort(); },
    }),
    async waitForFunction(fn, count) {
    const value = vm.runInNewContext(`(${fn.toString()})(count)`, { count,
      document: { querySelectorAll: () => [preview] } });
    if (!value) throw Object.assign(new Error('upload timeout'), { name: 'TimeoutError' });
    return { jsonValue: async () => value };
  } };
}

test('Qwen attaches actual bytes and waits for remote image preview, not input.files', async () => {
  const page = uploadPage();
  assert.equal(typeof composer.attachQwenImages, 'function');
  await composer.attachQwenImages(page, [image]);
  assert.deepEqual(page.selected, [[{ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from([1]) }]]);
  assert.deepEqual(page.clicks, ['select-mode', 'upload']);
});
test('Qwen opens the observed Russian attachment row before choosing image bytes', async () => {
  const page = uploadPage({ russian: true });
  await composer.attachQwenImages(page, [image]);
  assert.deepEqual(page.clicks, ['select-mode', 'upload']);
});
test('Qwen failed or unfinished image upload cannot dispatch a prompt', async () => {
  for (const state of [{ failed: true }, { pending: true }]) {
    await assert.rejects(composer.attachQwenImages(uploadPage(state), [image]), error => error.delivery === 'not_sent');
  }
});
test('Qwen fails before dispatch when the native chooser cannot open', async () => {
  const page = uploadPage({ rejectChooser: new Error('chooser blocked') });
  await assert.rejects(composer.attachQwenImages(page, [image]), error => error.delivery === 'not_sent' && error.code === 'QWEN_NATIVE_IMAGE_UPLOAD_FAILED');
  assert.deepEqual(page.clicks, ['select-mode']);
});
test('Qwen Stop prevents preview polling after the chooser selects files', async () => {
  const controller = new AbortController();
  const page = uploadPage({ abortOnSetFiles: controller });
  await assert.rejects(composer.attachQwenImages(page, [image], { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(page.selected, [[{ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from([1]) }]]);
});
test('Qwen agent forwards image turns exactly once through its account transport', async () => {
  const requests = [];
  const adapter = createQwenAgentAdapter(createQwenAgentTransport(async operation => operation({
    async complete(request) { requests.push(request); return { text: 'ok', lastMessageId: 'answer' }; },
  })));
  assert.equal(adapter.supportsImageAttachments, true);
  await adapter.complete({ sessionId: 'chat', prompt: 'look', images: [image] });
  await adapter.complete({ sessionId: 'chat', prompt: 'next' });
  assert.deepEqual(requests.map(request => request.images), [[image], []]);
});
