import { spawn } from 'node:child_process';
import { resolveAntigravityExecutable } from './runtime.mjs';

const MAX_OUTPUT = 4 * 1024 * 1024;

function runCli(command, args, { cwd = process.cwd(), signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(result);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT) child.kill();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > MAX_OUTPUT) child.kill();
    });
    child.once('error', (error) => finish(error));
    child.once('close', (status) => {
      if (stdout.length > MAX_OUTPUT || stderr.length > MAX_OUTPUT) return finish(new Error('Antigravity CLI output is too large'));
      finish(null, { status: status ?? 1, stdout, stderr });
    });
  });
}

export function parseAntigravityModels(output = '') {
  return String(output).split(/\r?\n/).map((line) => {
    const match = line.trim().match(/^([a-z][a-z0-9._-]+)\s{2,}(.+)$/i);
    return match ? { id: match[1], label: match[2].trim() } : null;
  }).filter(Boolean);
}

function parseRun(output = '') {
  let sessionId = null;
  let text = '';
  let result = null;
  const nativeTools = [];
  for (const line of String(output).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    sessionId ||= event.conversation_id || event.init?.conversation_id || event.result?.conversation_id || null;
    if (event.event === 'step_update' && event.step_update?.step_type === 'tool') nativeTools.push(event.step_update.tool_name || 'unknown');
    if (event.event === 'step_update' && event.step_update?.step_type === 'agent_response') {
      text += String(event.step_update.text_delta || '');
    }
    if (event.event === 'result') result = event.result;
  }
  return { sessionId: result?.conversation_id || sessionId, text: String(result?.response || text).trim(), result, nativeTools };
}

export class AntigravityClient {
  constructor({ executable = resolveAntigravityExecutable(), run = runCli } = {}) {
    this.executable = executable;
    this.run = run;
  }

  async listModels() {
    const response = await this.run(this.executable, ['models']);
    if (response.status !== 0) throw new Error(String(response.stderr || response.stdout || 'Antigravity models unavailable').trim());
    return parseAntigravityModels(response.stdout);
  }

  async complete({ prompt, model = null, sessionId = null, cwd = process.cwd(), signal, agent = null } = {}) {
    const input = String(prompt || '').trim();
    if (!input) throw new Error('Antigravity prompt is empty');
    const args = ['-p', input, '--output-format', 'stream-json', '--sandbox'];
    if (model) args.push('--model', String(model));
    if (sessionId) args.push('--conversation', String(sessionId));
    if (agent) args.push('--agent', String(agent));
    const response = await this.run(this.executable, args, { cwd, signal });
    const parsed = parseRun(response.stdout);
    if (agent === 'synvox-workspace' && parsed.nativeTools.length) {
      throw Object.assign(new Error('Antigravity вызвал собственный инструмент вместо действия SYNVOX. Проверьте совместимость CLI.'),
        { code: 'ANTIGRAVITY_UNEXPECTED_TOOL', sessionId: parsed.sessionId });
    }
    if (response.status !== 0 || parsed.result?.status !== 'SUCCESS') {
      const message = parsed.result?.error || response.stderr || 'Antigravity CLI did not finish successfully';
      const error = new Error(String(message).trim());
      error.sessionId = parsed.sessionId;
      throw error;
    }
    return { text: parsed.text, sessionId: parsed.sessionId };
  }
}
