import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const IMAGE_EXTENSIONS = {
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function imageExtension(mimeType) {
  return IMAGE_EXTENSIONS[String(mimeType || '').toLowerCase()] || 'png';
}

// Keep pixels out of textual tool logs/prompts; send them through image attachments.
export function prepareComputerScreenshot(result, supportsImages) {
  if (!result?.screenshot?.base64) return { result, images: [] };
  const { base64, ...screenshot } = result.screenshot;
  const images = supportsImages === true ? [{ name: `synvox-desktop.${imageExtension(screenshot.mime)}`, mimeType: screenshot.mime, dataBase64: base64 }] : [];
  return {
    result: { ...result, screenshot: { ...screenshot, imageDelivered: images.length > 0 },
      ...(!images.length ? { visionUnavailable: 'This provider cannot receive desktop screenshots. Use commands or user-supplied coordinates; do not guess screen content.' } : {}) },
    images,
  };
}

// Checkpoints retain file references, never a copy of the screenshot bytes.
export function cacheComputerImages(images) {
  return images.map(image => {
    const bytes = Buffer.from(image.dataBase64, 'base64');
    if (!bytes.length || bytes.length > 16_000_000) throw new Error('Desktop screenshot exceeds the image attachment limit.');
    const file = path.join(os.tmpdir(), `synvox-computer-image-${randomUUID()}.${imageExtension(image.mimeType)}`);
    fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
    return { path: file, name: image.name, mimeType: image.mimeType };
  });
}

function validCachePath(file) {
  return typeof file === 'string' && path.dirname(file) === os.tmpdir()
    && /^synvox-computer-image-[a-f0-9-]{36}\.(?:bmp|gif|jpg|png|webp)$/.test(path.basename(file));
}

export function readComputerImages(references) {
  return references.map(reference => {
    if (!validCachePath(reference.path)) throw new Error('Invalid desktop image checkpoint.');
    const stat = fs.lstatSync(reference.path);
    if (!stat.isFile() || stat.size > 16_000_000) throw new Error('Invalid desktop image checkpoint.');
    return { name: reference.name, mimeType: reference.mimeType, dataBase64: fs.readFileSync(reference.path).toString('base64') };
  });
}

export function removeComputerImages(references) {
  for (const reference of references) if (validCachePath(reference.path)) fs.rmSync(reference.path, { force: true });
}
