import path from 'node:path';

const formats = new Map([['image/png','png'],['image/jpeg','jpg'],['image/gif','gif'],['image/webp','webp'],['image/bmp','bmp']]);
export function toProviderImageFiles(images = []) {
  if (!Array.isArray(images) || images.length > 5) throw new Error('Image input must contain at most 5 images.');
  return images.map((image, index) => {
    const mimeType = String(image?.mimeType || '').toLowerCase().replace('image/jpg', 'image/jpeg');
    if (!formats.has(mimeType)) throw new Error('Unsupported image input format. Use PNG, JPEG, GIF, WebP or BMP.');
    const encoded = String(image?.dataBase64 || '');
    if (!encoded || encoded.length > 21_333_336 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid image bytes.');
    const buffer = Buffer.from(encoded, 'base64');
    if (!buffer.length || buffer.length > 16_000_000) throw new Error('Image input exceeds 16 MB.');
    const name = path.posix.basename(String(image.name || `synvox-image-${index+1}.${formats.get(mimeType)}`).replaceAll('\\', '/')).replace(/[\x00-\x1f]/g, '').slice(0, 150);
    return { name: name || `synvox-image-${index+1}.${formats.get(mimeType)}`, mimeType, buffer };
  });
}
