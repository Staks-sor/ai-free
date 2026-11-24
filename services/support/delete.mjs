import path from 'node:path';
import { createSupportService } from './service.mjs';

const [directory, id, confirmation] = process.argv.slice(2);
if (!directory || !path.isAbsolute(directory) || !/^[a-f0-9-]{36}$/.test(id || '') || confirmation !== '--confirm') {
  throw new Error('Usage: node services/support/delete.mjs /absolute/private/report-directory REPORT_UUID --confirm');
}
createSupportService({ directory }).remove(id);
console.log('Support report removed');
