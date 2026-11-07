// Что ответила модель в 15:0x (fabrication-раунды)?
import fs from 'node:fs';

const dirs = [
  'run-2026-10-23T15-01-57-715Z-acc_1790702387776',
  'run-2026-10-23T15-06-25-949Z-acc_1790702451270',
];

for (const dir of dirs) {
  const p = `telemetry/${dir}/events.jsonl`;
  if (!fs.existsSync(p)) { console.log(`${dir}: no events.jsonl`); continue; }
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const resps = lines.filter((ev) => (ev.data?.url || '').includes('chat/completions') && typeof ev.data?.body === 'string' && ev.data.body.length > 500);
  console.log(`\n=== ${dir} (${resps.length} SSE responses) ===`);
  let n = 0;
  for (const ev of resps) {
    n += 1;
    const body = ev.data.body;
    let content = '';
    for (const block of body.split('\n\n')) {
      const m = block.match(/^data: (.*)$/s);
      if (!m) continue;
      try {
        const j = JSON.parse(m[1]);
        const c = j?.choices?.[0]?.delta?.content;
        if (typeof c === 'string') content += c;
      } catch { /* ignore */ }
    }
    if (!content) continue;
    console.log(`\n--- response #${n} contentLen=${content.length} ---`);
    console.log(content.slice(0, 1200));
    if (content.length > 1200) console.log(`... [${content.length - 1200} симв. обрезано]`);
  }
}
