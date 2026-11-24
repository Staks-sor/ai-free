import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const directory = '/var/lib/synvox-merchant';
const backupDirectory = path.join(directory, 'backups');
fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(directory, 'licenses.sqlite'));
try { db.prepare('VACUUM INTO ?').run(path.join(backupDirectory, 'licenses-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite')); }
finally { db.close(); }
