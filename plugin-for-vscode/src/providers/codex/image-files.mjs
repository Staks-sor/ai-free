import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toProviderImageFiles } from '../image-input.mjs';

const IMAGE_EXTENSIONS = {
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function createPrivateImageFiles(images) {
  const attachments = toProviderImageFiles(images);
  if (!attachments.length) return { directory: null, paths: [] };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-codex-images-'));
  fs.chmodSync(directory, 0o700);
  try {
    const paths = attachments.map((image, index) => {
      const bytes = image.buffer;
      const extension = IMAGE_EXTENSIONS[image.mimeType];
      const file = path.join(directory, `${index}.${extension}`);
      fs.writeFileSync(file, bytes, { mode: 0o600 });
      return file;
    });
    return { directory, paths };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function removePrivateImageFiles(files) {
  if (files?.directory) fs.rmSync(files.directory, { recursive: true, force: true });
}
