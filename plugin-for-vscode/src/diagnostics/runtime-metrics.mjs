import { performance } from 'node:perf_hooks';

// Fixed numeric series only: no labels, prompts, identities, timers or disk I/O.
const KEYS = new Set(['model_ms', 'model_failed', 'queue_ms', 'queue_cancelled_ms',
  'rag_ms', 'rag_cpu_ms', 'rag_bytes', 'rag_items', 'rag_failed']);
const PROVIDERS = new Set(['qwen', 'deepseek', 'chatgpt', 'glm', 'google-ai']);
for (const provider of PROVIDERS) {
  for (const key of ['attempt_ms', 'retry_attempts', 'failed_attempts', 'buffered_attempts',
    'http_attempts', 'first_text_ms', 'first_progress_ms', 'content_gap_ms', 'headers_ms']) KEYS.add(`${provider}.${key}`);
}
const SAMPLE_LIMIT = 128;
export function createRuntimeMetrics() {
  const series = new Map();
  function record(key, value) {
    if (!KEYS.has(key) || typeof value !== 'number' || !Number.isFinite(value) || value < 0) return;
    if (!series.has(key)) series.set(key, { count:0, max:0, values:[], cursor:0 });
    const item = series.get(key);
    item.count++; item.max = Math.max(item.max, value);
    item.values[item.cursor] = value; item.cursor = (item.cursor + 1) % SAMPLE_LIMIT;
  }
  function snapshot() {
    return Object.fromEntries([...series].map(([key, item]) => {
      const values = [...item.values].sort((a,b) => a-b);
      const percentile = p => values[Math.ceil(values.length*p)-1];
      return [key, { count:item.count, samples:values.length, max:item.max, p50:percentile(.5), p95:percentile(.95) }];
    }));
  }
  return { record, snapshot };
}
export const runtimeMetrics = createRuntimeMetrics();

// Observation only: preserves buffered/streaming mode and never retries work.
export async function measureProviderExchange(provider, work, { onText = null, onThinking = null,
  attempt = 1, http = false, observeText = false, now = () => performance.now(), metrics = runtimeMetrics } = {}) {
  if (!PROVIDERS.has(provider)) throw new TypeError('Unknown provider');
  const started = now();
  let firstText = false, firstProgress = false, lastText, headersSeen = false;
  const record = (key, value) => metrics.record(`${provider}.${key}`, value);
  function progress(value, text) {
    if (typeof value !== 'string' || !value.length) return;
    const time = now();
    if (!firstProgress) { firstProgress = true; record('first_progress_ms', time-started); }
    if (text) {
      if (!firstText) { firstText = true; record('first_text_ms', time-started); }
      else record('content_gap_ms', time-lastText);
      lastText = time;
    }
  }
  const text = (...args) => { progress(args[0], true); return onText?.(...args); };
  const thinking = (...args) => { progress(args[0], false); return onThinking?.(...args); };
  if (http) record('http_attempts', 1);
  if (attempt > 1) record('retry_attempts', 1);
  if (!onText && !observeText) record('buffered_attempts', 1);
  try {
    return await work({ text, thinking, onText: onText || observeText ? text : null,
      onThinking: onThinking ? thinking : null,
      headers: () => { if (!headersSeen) { headersSeen = true; record('headers_ms', now()-started); } } });
  } catch (error) { record('failed_attempts', 1); throw error; }
  finally { record('attempt_ms', now()-started); }
}

export async function measureModelTurn(client, request) {
  const started = performance.now();
  try { return await client.complete(request); }
  catch (error) { runtimeMetrics.record('model_failed', 1); throw error; }
  finally { runtimeMetrics.record('model_ms', performance.now()-started); }
}

export function measureMemoryRetrieval(retrieve) {
  const started = performance.now(), cpu = process.cpuUsage();
  try {
    const result = retrieve();
    runtimeMetrics.record('rag_bytes', Buffer.byteLength(result.context || '', 'utf8'));
    runtimeMetrics.record('rag_items', result.usedCount || 0);
    return result;
  } catch (error) { runtimeMetrics.record('rag_failed', 1); throw error; }
  finally {
    const usage = process.cpuUsage(cpu);
    runtimeMetrics.record('rag_ms', performance.now()-started);
    runtimeMetrics.record('rag_cpu_ms', (usage.user+usage.system)/1000);
  }
}
