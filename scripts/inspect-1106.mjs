// 06.11: 1) что возвращали non-stream субагенты (512 chars); 2) темп запросов перед Baxia.
import fs from 'node:fs';

const dirs = fs.readdirSync('telemetry').filter((d) => d.startsWith('run-2026-11-06')).sort();
console.log(`директорий: ${dirs.length}`);

let nonStreamSamples = 0;
const reqTimestamps = [];
let baxiaCount = 0;

for (const dir of dirs) {
  for (const f of fs.readdirSync(`telemetry/${dir}`).filter((x) => x.startsWith('events'))) {
    const lines = fs.readFileSync(`telemetry/${dir}/${f}`, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    for (const ev of lines) {
      // темп: время запроса к completions
      if ((ev.data?.url || '').includes('completions') && ev.data?.postData != null) {
        if (ev.ts || ev.time || ev.timestamp) reqTimestamps.push(new Date(ev.ts || ev.time || ev.timestamp).getTime());
      }
      // non-stream ответы субагентов
      const body = ev.data?.body;
      if (typeof body === 'string' && body.length > 50 && !(ev.data?.url || '').includes('chat/qwen') && !body.startsWith('data:')) {
        // JSON-ответ non-stream
        try {
          const j = JSON.parse(body);
          const c = j?.choices?.[0]?.message?.content;
          if (typeof c === 'string' && c.length > 100 && nonStreamSamples < 4) {
            nonStreamSamples += 1;
            console.log(`\n=== non-stream ответ #${nonStreamSamples} (${dir.slice(-20)}) len=${c.length} ===`);
            console.log(c.slice(0, 400));
          }
        } catch {}
      }
      // SSE-ответы: ищем содержимое 512-символьных
      if (typeof body === 'string' && body.includes('data: ')) {
        let content = '';
        for (const block of body.split('\n\n')) {
          const m = block.match(/^data: (.*)$/s);
          if (!m) continue;
          try { const j = JSON.parse(m[1]); const c = j?.choices?.[0]?.delta?.content; if (typeof c === 'string') content += c; } catch {}
        }
        if (content.length > 400 && content.length < 700 && nonStreamSamples < 6 && content.includes('инструмент')) {
          nonStreamSamples += 1;
          console.log(`\n=== SSE-ответ ~512 (${dir.slice(-20)}) len=${content.length} ===`);
          console.log(content.slice(0, 400));
        }
      }
      if (typeof body === 'string' && /baxia|punish|captcha/i.test(body)) baxiaCount += 1;
    }
  }
}

// Темп
reqTimestamps.sort((a, b) => a - b);
if (reqTimestamps.length > 1) {
  const span = (reqTimestamps[reqTimestamps.length - 1] - reqTimestamps[0]) / 1000;
  console.log(`\nзапросов к completions: ${reqTimestamps.length},_span ${Math.round(span)}s, средний интервал ${Math.round(span / Math.max(1, reqTimestamps.length - 1))}s`);
  // минимальные интервалы
  const gaps = [];
  for (let i = 1; i < reqTimestamps.length; i++) gaps.push(reqTimestamps[i] - reqTimestamps[i - 1]);
  gaps.sort((a, b) => a - b);
  console.log(`мин. интервалы (мс): ${gaps.slice(0, 10).map((g) => Math.round(g)).join(', ')}`);
}
console.log(`\nbaxia-упоминаний в тело ответов: ${baxiaCount}`);
