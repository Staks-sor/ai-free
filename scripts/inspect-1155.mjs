// Инцидент 29.10 11:55: fabrication на попытке 1, попытка 2 прошла гейт
// (протекла проза «технические проблемы» к юзеру). Что именно отвечала модель?
import fs from 'node:fs';

const dirs = [
  'telemetry/run-2026-10-29T11-53-25-485Z-acc_1790702167522',
  'telemetry/run-2026-10-29T11-55-10-017Z-acc_1790702315380',
];

for (const dir of dirs) {
  if (!fs.existsSync(dir)) { console.log('нет ' + dir); continue; }
  console.log('\n########', dir.split('telemetry/')[1]);
  for (const f of fs.readdirSync(dir).filter((x) => x.startsWith('events'))) {
    const lines = fs.readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const resps = lines.filter((ev) => typeof ev.data?.body === 'string' && (ev.data?.url || '').includes('completions') && ev.data.body.length > 100);
    let i = 0;
    for (const ev of resps) {
      let content = ''; let reasoning = '';
      for (const block of ev.data.body.split('\n\n')) {
        const m = block.match(/^data: (.*)$/s);
        if (!m) continue;
        try {
          const j = JSON.parse(m[1]);
          const d = j?.choices?.[0]?.delta;
          if (typeof d?.content === 'string') content += d.content;
          if (typeof d?.reasoning_content === 'string') reasoning += d.reasoning_content;
        } catch {}
      }
      if (content || reasoning) {
        i += 1;
        console.log(`\n=== ответ #${i} content=${content.length} reasoning=${reasoning.length}`);
        if (content) console.log('[CONTENT]\n' + content.slice(0, 700));
      }
    }
  }
}
