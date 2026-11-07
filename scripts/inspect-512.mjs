// 512-символьные ответы: что именно внутри? Ищем их в SSE-телах.
import fs from 'node:fs';

const dirs = fs.readdirSync('telemetry').filter((d) => d.startsWith('run-2026-11-06')).sort();
let shown = 0;

for (const dir of dirs) {
  for (const f of fs.readdirSync(`telemetry/${dir}`).filter((x) => x.startsWith('events'))) {
    const lines = fs.readFileSync(`telemetry/${dir}/${f}`, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    for (const ev of lines) {
      const body = ev.data?.body;
      if (typeof body !== 'string' || !body.startsWith('data: ')) continue;
      let content = '';
      for (const block of body.split('\n\n')) {
        const m = block.match(/^data: (.*)$/s);
        if (!m) continue;
        try { const j = JSON.parse(m[1]); const c = j?.choices?.[0]?.delta?.content; if (typeof c === 'string') content += c; } catch {}
      }
      //Ищем ответы ~512 (диапазон 450-700), печатаем первые 3 ПОЛНОСТЬЮ
      if (content.length >= 450 && content.length <= 700 && shown < 3) {
        shown += 1;
        console.log(`\n===== ответ #${shown} (${dir.slice(-15)}/${f}) len=${content.length} =====`);
        console.log(content);
      }
      if (shown >= 3) break;
    }
    if (shown >= 3) break;
  }
  if (shown >= 3) break;
}
console.log(`\nпоказано: ${shown}`);
