// Что ответила модель в 21:27 (новая сессия, fabrication x3) и что было в промпте?
import fs from 'node:fs';

const dir = 'run-2026-10-23T21-27-52-532Z-acc_1790702167522';
const p = `telemetry/${dir}/events.jsonl`;
const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// Запросы к chat/completions: postData
const reqs = lines.filter((ev) => (ev.data?.url || '').includes('chat/completions') && ev.data?.postData);
console.log(`=== запросов: ${reqs.length} ===`);
const req = reqs[0];
if (req) {
  const pd = req.data.postData;
  console.log(`postData len=${pd.length}`);
  const contentMatch = /"content":"([\s\S]{0,3000})/.exec(pd);
  if (contentMatch) {
    console.log('--- content head (3000) ---');
    console.log(contentMatch[1].slice(0, 3000));
  }
  // Ищем упоминание PLAN.md
  const planIdx = pd.indexOf('PLAN.md');
  console.log(`\nPLAN.md упомянут в позиции: ${planIdx}`);
  if (planIdx > -1) console.log(pd.slice(Math.max(0, planIdx - 300), planIdx + 500));
}

// Ответы
const resps = lines.filter((ev) => typeof ev.data?.body === 'string' && ev.data.body.length > 300 && (ev.data?.url || '').includes('chat/completions'));
console.log(`\n=== SSE-ответов: ${resps.length} ===`);
for (const ev of resps) {
  let content = '';
  for (const block of ev.data.body.split('\n\n')) {
    const m = block.match(/^data: (.*)$/s);
    if (!m) continue;
    try {
      const j = JSON.parse(m[1]);
      const c = j?.choices?.[0]?.delta?.content;
      if (typeof c === 'string') content += c;
    } catch { /* ignore */ }
  }
  if (content) {
    console.log(`\n--- contentLen=${content.length} ---`);
    console.log(content.slice(0, 800));
  }
}
