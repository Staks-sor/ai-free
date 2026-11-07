// Разбор SSE-ответов телеметрии: собираем контент по чанкам.
import fs from 'node:fs';

const dirs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync('telemetry').filter((d) => d.startsWith('run-2026-10-23T14-')).sort();

for (const dir of dirs) {
  const p = `telemetry/${dir}/events.jsonl`;
  if (!fs.existsSync(p)) { console.log(`${dir}: no events.jsonl`); continue; }
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const resps = lines.filter((ev) => (ev.data?.url || '').includes('chat/completions') && typeof ev.data?.body === 'string' && ev.data.body.length > 1000);
  console.log(`\n=== ${dir} (${resps.length} SSE responses) ===`);
  for (const ev of resps) {
    const body = ev.data.body;
    let content = '';
    let outTokens = 0;
    let lastStatus = '';
    // SSE events разделены \n\n; телеметрия хранит сырой текст
    for (const block of body.split('\n\n')) {
      const m = block.match(/^data: (.*)$/s);
      if (!m) continue;
      try {
        const j = JSON.parse(m[1]);
        const c = j?.choices?.[0]?.delta?.content;
        if (typeof c === 'string') content += c;
        if (typeof j?.usage?.output_tokens === 'number') outTokens = j.usage.output_tokens;
        const st = j?.choices?.[0]?.delta?.status;
        if (st) lastStatus = st;
      } catch { /* не JSON — игнор */ }
    }
    const fenceStart = content.indexOf('```tool_calls');
    const fenceEnd = fenceStart !== -1 ? content.indexOf('```', content.indexOf('\n', fenceStart) + 1) : -1;
    console.log(`  contentLen=${content.length} outTokens=${outTokens} status=${lastStatus} toolBlock=${fenceStart !== -1} fenceClosed=${fenceEnd !== -1}`);
    console.log(`    head: ${JSON.stringify(content.slice(0, 110).replace(/\n/g, '\\n'))}`);
    console.log(`    tail: ${JSON.stringify(content.slice(-180).replace(/\n/g, '\\n'))}`);
    if (fenceStart !== -1 && fenceEnd === -1) console.log('    >>> TRUNCATED tool_calls BLOCK <<<');
  }
}
