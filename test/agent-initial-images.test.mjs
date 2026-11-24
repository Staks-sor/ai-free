import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCodeTask } from '../src/code-agent/run.mjs';
import { removeComputerImages } from '../src/code-agent/computer-images.mjs';
import { buildAgentTaskOptions } from '../src/window-app/agent-task.mjs';

const image = { name: 'fixture.png', mimeType: 'image/png', dataBase64: 'AQ==' };
test('all provider task options preserve original image attachments', () => {
  for (const provider of ['qwen','deepseek','chatgpt','glm','googleai','codex']) {
    assert.deepEqual(buildAgentTaskOptions({ provider }, { images: [image] }, { agentInput: {} }).images, [image]);
  }
});
test('initial images survive a failed model call in private resumable checkpoints and are sent once', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-initial-vision-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let saved;
  const requests = [];
  const options = { memoryEnabled: false, images: [image], onCheckpoint: value => { saved = value; } };
  await assert.rejects(runCodeTask({ supportsImageAttachments: true, async complete(request) {
    requests.push(request); throw new Error('transport failed');
  } }, {}, root, 'опиши картинку', null, options), /transport failed/);
  t.after(() => removeComputerImages(saved?.pendingImagePaths || []));
  assert.deepEqual(requests[0].images, [image]);
  assert.equal(saved.pendingImagePaths.length, 1);
  assert.equal(JSON.stringify(saved).includes(image.dataBase64), false);
  const cachedPath = saved.pendingImagePaths[0].path;
  await runCodeTask({ supportsImageAttachments: true, async complete(request) {
    requests.push(request); return { text: '{"tool":"finish","message":"Картинка проверена"}' };
  } }, {}, root, 'опиши картинку', null, { ...options, resumeState: saved });
  assert.deepEqual(requests[1].images, [image]);
  assert.equal(fs.existsSync(cachedPath), false);
});
