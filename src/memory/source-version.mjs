import fs from 'node:fs';
export function fileVersion(file) {
  try { const s = fs.statSync(file, { bigint: true }); return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`; }
  catch (error) { if (error.code === 'ENOENT') return 'missing'; throw error; }
}
