// 07.11 ночь: что происходило с запросами субагентов (1:36-2:30).
import fs from 'node:fs';

const dirs = fs.readdirSync('telemetry').filter((d) => d.startsWith('run-2026-11-06T20-')).sort();
console.log(`директорий: ${dirs.length}`);
for (const d of dirs) console.log(' ', d);

// Собираем события по всем директориям
let total = 0, errors = 0, ok = 0;
const errorKinds = {};
const reqs = [];

for (const dir of dirs) {
  const base = `telemetry/${dir}`;
  for (const f of fs.readdirSync(base).filter((x) => x.startsWith('events'))) {
    const lines = fs.readFileSync(`${base}/${f}`, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    for (const ev of lines) {
      const url = ev.data?.url || '';
      if (!url.includes('completions')) continue;
      total += 1;
      const body = typeof ev.data?.body === 'string' ? ev.data.body : '';
      const pd = ev.data?.postData;
      // признак ошибки: punish/401/unauthorized/пустой body после create
      if (/punish|captcha|unauthorized|rate.?limit/i.test(body) && body.length < 3000 && !body.startsWith('data:')) {
        errors += 1;
        const kind = (body.match(/punish|captcha|unauthorized|rate.?limit/i) || ['?'])[0];
        errorKinds[kind] = (errorKinds[kind] || 0) + 1;
      }
      if (body.startsWith('data:')) ok += 1;
      // stream/no-stream + tools count
      if (pd) {
        const isStream = /"stream"\s*:\s*true/.test(pd);
        const toolsMatch = pd.match(/"tools"\s*:\s*\[(.{0,80})/);
        reqs.push({ t: ev.ts || '', dir: dir.slice(-16), stream: isStream, len: pd.length });
      }
    }
  }
}
console.log(`\nсобытий completions: ${total}, SSE-ответов: ${ok}, error-тел: ${errors}`);
console.log('виды ошибок:', JSON.stringify(errorKinds));
console.log(`\nзапросов с postData: ${reqs.length}`);
console.log('stream=true:', reqs.filter((r) => r.stream).length, '| stream=false:', reqs.filter((r) => !r.stream).length);
