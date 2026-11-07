// Диагностика reasoning: 1) просил ли Hermes thinking; 2) слал ли Qwen phase:"think".
import fs from 'node:fs';

const dirs = [
  'telemetry/run-2026-10-29T11-24-26-050Z-acc_1790702167522',
];
// и свежие от 28.10
for (const d of fs.readdirSync('telemetry')) if (d.startsWith('run-2026-10-28') || d.startsWith('run-2026-10-29')) dirs.push('telemetry/' + d);

const seen = new Set();
for (const dir of [...new Set(dirs)]) {
  for (const f of fs.readdirSync(dir).filter((x) => x.startsWith('events'))) {
    const p = `${dir}/${f}`;
    if (seen.has(p)) continue;
    seen.add(p);
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

    // 1) исходящий completion-payload (прокси → Qwen): thinking_enabled?
    for (const ev of lines) {
      const pd = ev.data?.postData;
      if (typeof pd === 'string' && pd.includes('thinking_enabled')) {
        const m = pd.match(/"thinking_enabled"\s*:\s*(true|false)/);
        const m2 = pd.match(/"thinking_budget"\s*:\s*(\d+)/);
        const m3 = pd.match(/"chat_mode"\s*:\s*"([^"]+)"/);
        console.log(`${dir.split('telemetry/')[1]}/${f}: thinking_enabled=${m?.[1]} budget=${m2?.[1] ?? '-'} chat_mode=${m3?.[1] ?? '-'}`);
        break;
      }
    }

    // 2) think-фазы в ответах Qwen
    let thinkChars = 0, answerChars = 0, phases = new Set();
    for (const ev of lines) {
      const body = ev.data?.body;
      if (typeof body !== 'string' || !(ev.data?.url || '').includes('completions')) continue;
      for (const block of body.split('\n\n')) {
        const m = block.match(/^data: (.*)$/s);
        if (!m) continue;
        try {
          const j = JSON.parse(m[1]);
          const walk = (o) => {
            if (!o || typeof o !== 'object') return;
            if (typeof o.phase === 'string') phases.add(o.phase);
            if (o.phase === 'think') {
              const t = typeof o.content === 'string' ? o.content : (Array.isArray(o.content) ? o.content.map((c) => c?.text || '').join('') : '');
              thinkChars += t.length;
            }
            for (const v of Object.values(o)) walk(v);
          };
          walk(j);
        } catch {}
      }
    }
    if (phases.size) console.log(`  phases: ${[...phases].join(',')} | think_chars=${thinkChars}`);
  }
}
