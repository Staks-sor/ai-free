import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import * as http from '../src/window-app/http.mjs';

test('the message reader accepts a valid five-image batch exceeding the old 30 MB limit', async () => {
  const dataBase64 = Buffer.alloc(5 * 1024 * 1024).toString('base64');
  const body = JSON.stringify({ content: 'Describe these images', images: Array.from({ length: 5 }, (_, i) => ({ name: `${i}.png`, mimeType: 'image/png', dataBase64 })) });
  const request = Readable.from([body]);
  const parsed = await http.readJsonBody(request, http.MAX_IMAGE_MESSAGE_BODY_BYTES);
  assert.equal(parsed.images.length, 5);
  assert.equal(parsed.images[0].dataBase64.length, dataBase64.length);
});
