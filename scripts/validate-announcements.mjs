import fs from 'node:fs';
import { normalizeAnnouncementFeed } from '../src/announcements/client.mjs';

const file = process.argv[2] || new URL('../website/static/api/v1/announcements.json', import.meta.url);
const bytes = fs.readFileSync(file);
if (bytes.length > 131072) throw new Error('Announcement feed exceeds 128 KiB');
const announcements = normalizeAnnouncementFeed(JSON.parse(bytes));
console.log(`Announcements valid: ${announcements.length}`);
