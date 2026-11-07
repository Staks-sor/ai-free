// 07.11 ночь (06.11 20:36-21:30 UTC): судьба запросов субагентов.
import fs from 'node:fs';

const dirs = [
  'run-2026-11-06T20-37-41-834Z-acc_1790702726049',
  'run-2026-11-06T20-38-28-711Z-acc_1790704084587',
  'run-2026-11-06T20-39-34-175Z-acc_1790708423905',
  'run-2026-11-06T20-40-21-508Z-acc_1791624472706',
  'run-2026-11-06T20-41-12-827Z-acc_1791624629384',
  'run-2026-11-06T20-42-36-479Z-acc_1791624659669',
  'run-2026-11-06T20-45-57-724Z-acc_1791742049489',
  'run-2026-11-06T20-48-20-862Z-acc_1791742145305',
  'run-2026-11-06T20-49-05-887Z-acc_1791742266107',
  'run-2026-11-06T20-49-20-761Z-acc_1791742395022',
  'run-2026-11-06T20-59-40-630Z-acc_1790702451270',
];

for (const dir of dirs) {
  const base = `telemetry/${dir}`;
  if (!fs.existsSync(base)) continue;
  let reqIn = 0, respOk = 0, respErr = 0, respEmpty = 0, contentChars = 0;
  const errSnippets = [];
  for (const f of fs.readdirSync(base).filter((x) => x.startsWith('events'))) {
    const raw = fs.readFileSync(`${base}/${f}`, 'utf8');
    const lines = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    for (const ev of lines) {
      const url = ev.data?.url || '';
      if (!url.includes('completions')) continue;
      if (ev.data?.postData != null) reqIn += 1;
      const body = typeof ev.data?.body === 'string' ? ev.data.body : '';
      if (!body) continue;
      if (body.startsWith('data: ')) {
        respOk += 1;
        for (const block of body.split('\n\n')) {
          const m = block.match(/^data: (.*)$/s);
          if (!m) continue;
          try { const j = JSON.parse(m[1]); const c = j?.choices?.[0]?.delta?.content; if (typeof c === 'string') contentChars += c.length; } catch {}
        }
      } else if (body.length < 5000) {
        respErr += 1;
        if (errSnippets.length < 2) errSnippets.push(body.slice(0, 200));
      } else respEmpty += 1;
    }
  }
  console.log(`${dir.slice(-16).padEnd(17)} req=${String(reqIn).padStart(2)} sseOk=${String(respOk).padStart(2)} err=${respErr} other=${respEmpty} content=${contentChars}`);
  for (const s of errSnippets) console.log('   err:', s.replace(/\n/g, ' ').slice(0, 180));
}
