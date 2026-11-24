import test from 'node:test';
import assert from 'node:assert/strict';
const helper = () => import('../src/providers/image-input.mjs');
test('Codex rejects unsupported image formats before creating temporary files', async () => {
  const { createPrivateImageFiles } = await import('../src/providers/codex/image-files.mjs');
  assert.throws(() => createPrivateImageFiles([{ mimeType: 'image/svg+xml', dataBase64: 'AQ==' }]), /Unsupported image input format/);
});
test('provider image payloads validate bytes and keep file names local on every OS', async () => {
 const {toProviderImageFiles}=await helper();
 const files=toProviderImageFiles([{name:'C:\\private\\check.png',mimeType:'image/png',dataBase64:Buffer.from('pixels').toString('base64')}]);
 assert.equal(files[0].name,'check.png');assert.equal(files[0].mimeType,'image/png');assert.equal(files[0].buffer.toString(),'pixels');
 assert.deepEqual(toProviderImageFiles(),[]);
});
test('invalid, non-image or excessive attachments fail before upload', async () => {
 const {toProviderImageFiles}=await helper();
 for(const images of [ [{mimeType:'image/svg+xml',dataBase64:'AQ=='}], [{mimeType:'image/png',dataBase64:'not base64!'}], [{mimeType:'image/png',dataBase64:''}], Array(6).fill({mimeType:'image/png',dataBase64:'AQ=='}) ])assert.throws(()=>toProviderImageFiles(images));
});
