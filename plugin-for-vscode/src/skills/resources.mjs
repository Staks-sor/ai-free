import fs from 'node:fs';
import path from 'node:path';

// Resource reads never run scripts or change the agent's permissions.
export function readSkillResource(skill, relativePath) {
  const source = fs.realpathSync(skill.source);
  const root = fs.statSync(source).isDirectory() ? source : path.dirname(source);
  const requested = String(relativePath || '');
  const candidate = path.resolve(root, requested);
  const inside = target => {
    const relative = path.relative(root, target);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  if (!requested || path.isAbsolute(requested) || !inside(candidate)) throw new Error('Skill resource is outside its directory');
  const target = fs.realpathSync(candidate);
  if (!inside(target)) throw new Error('Skill resource is outside its directory');
  const fd = fs.openSync(target, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('Skill resource must be a file');
    const buffer = Buffer.alloc(Math.min(stat.size, 16_384));
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (buffer.subarray(0, read).includes(0)) throw new Error('Skill resource must be text');
    return { ok: true, path: requested, content: buffer.subarray(0, read).toString('utf8'), truncated: stat.size > read };
  } finally { fs.closeSync(fd); }
}
