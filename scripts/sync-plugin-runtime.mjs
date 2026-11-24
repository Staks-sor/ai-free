// Copy the approved client runtime only; never merchant service or local data.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, 'plugin-for-vscode');
for (const directory of ['src', 'api', 'bin', 'packages/core']) {
  fs.cpSync(path.join(root, directory), path.join(target, directory), {
    recursive: true,
    filter: source => {
      if (fs.statSync(source).isDirectory()) return !['node_modules', 'test', 'tests', '__tests__'].includes(path.basename(source));
      const name = path.basename(source);
      return !name.startsWith('.') && !/\.(db|sqlite|sqlite3|key|p12|pfx)$/.test(name)
        && (!name.endsWith('.pem') || name === 'merchant-public.pem') && !/\.(test|spec)\./.test(name);
    },
  });
}
console.log('VS Code client runtime synchronized. No merchant service or private credentials copied.');
