// Верификация на РЕАЛЬНОМ инциденте: контент из telemetry run-14-42 (README
// с вложенными markdown-фенсами внутри content, path последним ключом).
import fs from 'node:fs';
import { StreamParser } from '../api/openai-handler.mjs';
import { Writable } from 'node:stream';

const p = 'telemetry/run-2026-10-23T14-42-23-256Z-acc_1790702315380/events.jsonl';
const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const resp = lines.find((ev) => (ev.data?.url || '').includes('chat/completions') && typeof ev.data?.body === 'string' && ev.data.body.length > 1000);
if (!resp) { console.error('no SSE response found'); process.exit(1); }

let content = '';
for (const block of resp.data.body.split('\n\n')) {
  const m = block.match(/^data: (.*)$/s);
  if (!m) continue;
  try {
    const j = JSON.parse(m[1]);
    const c = j?.choices?.[0]?.delta?.content;
    if (typeof c === 'string') content += c;
  } catch { /* ignore */ }
}

console.log(`Восстановлено контента: ${content.length} симв.`);
console.log(`Блок tool_calls: ${content.includes('```tool_calls')}`);

const res = new Writable({ write(c, e, cb) { this.chunks.push(Buffer.from(c)); cb(); } });
res.chunks = []; res.setHeader = () => {}; res.statusCode = 200;
const tools = [{
  type: 'function',
  function: {
    name: 'write_file',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
}];
// Схема как у Hermes: path и content required
const parser = new StreamParser('qwen3.8-max', res, { tools });

// Кормим чанками по 200 симв. — как настоящий стрим
for (let i = 0; i < content.length; i += 200) {
  parser.onText(content.slice(i, i + 200));
}
await parser.onEnd();

const events = Buffer.concat(res.chunks).toString('utf8').split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
const toolCalls = events.flatMap((e) => e.choices[0].delta.tool_calls || []);
console.log(`tool_calls отдано Hermes: ${toolCalls.length}`);
if (toolCalls.length) {
  const fn = toolCalls[0].function;
  console.log(`  name: ${fn.name}`);
  const args = JSON.parse(fn.arguments);
  console.log(`  path: ${args.path}`);
  console.log(`  contentLen: ${String(args.content || '').length}`);
  console.log(`  content содержит код-блок: ${args.content?.includes('MSYS_NO_PATHCONV=1')}`);
  const finish = events.at(-1).choices[0].finish_reason;
  console.log(`  finish_reason: ${finish}`);
  const ok = args.path && args.content && args.content.includes('MSYS_NO_PATHCONV=1');
  console.log(ok ? '\n✅ РЕАЛЬНЫЙ ИНЦИДЕНТ ПРОЙДЕН: полный вызов с path и content' : '\n❌ ПРОВАЛ');
  process.exit(ok ? 0 : 1);
}
