// Статистика tool-вызовов и размеров ответов за 2026-10-25 (сессия ~11:06-11:16).
import fs from 'node:fs';

const dirs = fs.readdirSync('telemetry').filter((d) => d.startsWith('run-2026-10-25T11-')).sort();
const toolCounts = {};
let totalCalls = 0;
const answerLens = [];

for (const dir of dirs) {
  const p = `telemetry/${dir}/events.jsonl`;
  if (!fs.existsSync(p)) continue;
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const resps = lines.filter((ev) => typeof ev.data?.body === 'string' && (ev.data?.url || '').includes('completions') && ev.data.body.length > 200);
  for (const ev of resps) {
    let content = '';
    for (const block of ev.data.body.split('\n\n')) {
      const m = block.match(/^data: (.*)$/s);
      if (!m) continue;
      try { const j = JSON.parse(m[1]); const c = j?.choices?.[0]?.delta?.content; if (typeof c === 'string') content += c; } catch {}
    }
    if (!content) continue;
    const fenceStart = content.indexOf('```tool_calls');
    if (fenceStart === -1) {
      answerLens.push(content.length);
      continue;
    }
    // считаем имена вызовов
    for (const m of content.matchAll(/"name"\s*:\s*"([^"]+)"/g)) {
      toolCounts[m[1]] = (toolCounts[m[1]] || 0) + 1;
      totalCalls += 1;
    }
  }
}

console.log('=== Инструменты (25.10, сессия 11:06-11:16) ===');
for (const [name, n] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(3)}  ${name}`);
console.log(`\nВсего вызовов: ${totalCalls}`);
console.log(`Проза-ответов (без tool_calls): ${answerLens.length}, средняя длина: ${answerLens.length ? Math.round(answerLens.reduce((a, b) => a + b, 0) / answerLens.length) : 0} симв.`);
