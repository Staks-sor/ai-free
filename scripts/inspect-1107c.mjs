// Что отвечала модель субагентам 07.11 ночью: ищем прозаические отказы и CoT-мусор.
import fs from 'node:fs';

const dirs = [
  'run-2026-11-06T20-45-57-724Z-acc_1791742049489',
  'run-2026-11-06T20-48-20-862Z-acc_1791742145305',
  'run-2026-11-06T20-49-05-887Z-acc_1791742266107',
  'run-2026-11-06T20-49-20-761Z-acc_1791742395022',
  'run-2026-11-06T20-59-40-630Z-acc_1790702451270',
];

for (const dir of dirs) {
  const base = `telemetry/${dir}`;
  for (const f of fs.readdirSync(base).filter((x) => x.startsWith('events'))) {
    const lines = fs.readFileSync(`${base}/${f}`, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    let i = 0;
    for (const ev of lines) {
      const body = typeof ev.data?.body === 'string' ? ev.data.body : '';
      if (!body.startsWith('data: ')) continue;
      let content = '';
      for (const block of body.split('\n\n')) {
        const m = block.match(/^data: (.*)$/s);
        if (!m) continue;
        try { const j = JSON.parse(m[1]); const c = j?.choices?.[0]?.delta?.content; if (typeof c === 'string') content += c; } catch {}
      }
      if (!content) continue;
      i += 1;
      // ищем признаки отказа/прозы-не-тулколл
      const isRefusal = /не могу|недоступн|не отвечает|technical|сбой|timeout|таймаут/i.test(content.slice(0, 300));
      const hasToolCalls = content.includes('tool_calls');
      if (isRefusal || (!hasToolCalls && content.length > 200)) {
        console.log(`\n===== ${dir.slice(-14)}/${f} ответ#${i} len=${content.length} toolCalls=${hasToolCalls} =====`);
        console.log(content.slice(0, 500));
      }
    }
  }
}
