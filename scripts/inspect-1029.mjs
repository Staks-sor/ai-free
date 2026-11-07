// Что модель отвечала в fabrication-раундах 29.10 11:24 (3 попытки)?
import fs from 'node:fs';

const dir = 'telemetry/run-2026-10-29T11-24-26-050Z-acc_1790702167522';
for (const f of fs.readdirSync(dir).filter((x) => x.startsWith('events'))) {
  const p = `${dir}/${f}`;
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const resps = lines.filter((ev) => typeof ev.data?.body === 'string' && (ev.data?.url || '').includes('completions') && ev.data.body.length > 100);
  let i = 0;
  for (const ev of resps) {
    let content = '';
    let reasoning = '';
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
      console.log(`\n===== ответ #${i} (${f}) content=${content.length} reasoning=${reasoning.length} =====`);
      if (reasoning) console.log('[REASONING head]\n' + reasoning.slice(0, 400));
      console.log('[CONTENT]\n' + content.slice(0, 1200));
    }
  }
}
