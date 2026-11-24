import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AI_FREE_VERSION } from '../config.mjs';
import { getCamoufoxInstallState } from '../browser/camoufox-runtime.mjs';
import { resolveLogDirectory } from '../logging/logger.mjs';
import { probeRuntimeCommand } from '../updater.mjs';
import { normalizeSupportReport, supportEvent, supportErrorCode, SUPPORT_CONSENT_VERSION } from './report.mjs';
import { SUPPORT_POLICY } from '../../packages/core/src/legal/support.mjs';

// Dedicated origin must point directly to the verified support host in Russia.
export const SUPPORT_ENDPOINT = 'https://support.synvox.pro/v1/support/reports';

function eventTail() {
  let fd;
  try {
    fd = fs.openSync(path.join(resolveLogDirectory(), 'ai-free.log'), 'r');
    const size = fs.fstatSync(fd).size, start = Math.max(0, size - 256_000), buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start) lines.shift();
    return lines.slice(-200).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  } catch { return []; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

async function pythonVersion() {
  for (const command of ['python3', 'python']) {
    const result = await probeRuntimeCommand(command);
    if (result.ok && /Python 3\./.test(result.version || '')) return result.version;
  }
  return '';
}

export async function collectSupportDiagnostics({ context = {}, probePython = pythonVersion, readEvents = eventTail } = {}) {
  const build = createHash('sha256');
  for (const name of ['../../package.json', '../config.mjs', '../window-app/server.mjs', '../window-app/ui-html.mjs', '../providers/qwen/browser-proxy.mjs', './client.mjs']) {
    build.update(name); build.update(fs.readFileSync(new URL(name, import.meta.url)));
  }
  const browser = getCamoufoxInstallState();
  const diagnostics = {
    app: { version: AI_FREE_VERSION, build: build.digest('hex'), node: process.version,
      surface: process.env.AI_FREE_VSCODE === '1' ? 'vscode' : process.env.AI_FREE_JETBRAINS === '1' ? 'jetbrains' : 'desktop',
      extensionVersion: process.env.SYNVOX_EXTENSION_VERSION || '', ideVersion: process.env.SYNVOX_IDE_VERSION || '' },
    system: { platform: process.platform, release: os.release(), arch: process.arch },
    runtime: { python: String(await probePython()).match(/3\.\d+(?:\.\d+)?/)?.[0] || '', camoufox: browser.version, browserPhase: browser.phase },
    failure: { provider: context.provider, model: context.model, code: supportErrorCode(context.error) },
    events: readEvents().filter(e => e.level === 'error' || e.level === 'warn' || ['qwen-network', 'deepseek-captcha'].includes(e.component)).slice(-60).map(supportEvent),
  };
  return normalizeSupportReport({ schema: 1, id: randomUUID(), createdAt: new Date().toISOString(), diagnostics }).diagnostics;
}

export function createSupportDrafts({ collect = collectSupportDiagnostics,
  enabled = process.env.SYNVOX_SUPPORT_REPORTING_ENABLED === '1', now = Date.now, send = sendSupportReport } = {}) {
  const drafts = new Map();
  function prune() { for (const [id, draft] of drafts) if (now() - draft.at > 30 * 60_000) drafts.delete(id); }
  return {
    config: () => ({ enabled, policy: SUPPORT_POLICY, endpoint: SUPPORT_ENDPOINT }),
    async prepare(input = {}) {
      prune();
      if (drafts.size >= 10) throw new Error('Слишком много отчётов. Закройте прежние окна и повторите позже.');
      const report = normalizeSupportReport({ schema: 1, id: randomUUID(), createdAt: new Date(now()).toISOString(),
        description: input.description, contact: input.contact, screenshot: input.screenshot,
        diagnostics: await collect({ context: input.context || {} }) });
      const draftId = randomUUID();
      drafts.set(draftId, { report, at: now() });
      // Return a copy: the immutable server draft remains the exact preview sent later.
      return { draftId, report: structuredClone(report), policy: SUPPORT_POLICY, enabled };
    },
    async submit({ draftId, consent } = {}) {
      prune();
      if (consent !== true) throw new Error('Separate support consent required');
      if (!enabled) throw new Error('Reporting disabled: отправка пока отключена; сохраните отчёт файлом.');
      const draft = drafts.get(draftId);
      if (!draft) throw new Error('Отчёт устарел. Подготовьте его снова и проверьте данные.');
      if (draft.receipt) return draft.receipt;
      if (!draft.pending) {
        draft.pending = Promise.resolve().then(() => send({ report: structuredClone(draft.report), consent: { accepted: true, version: SUPPORT_CONSENT_VERSION } }))
          .then(receipt => {
            if (receipt?.accepted !== true || receipt.id !== draft.report.id) throw new Error('Сервер не подтвердил приём отчёта. Повторите отправку этого отчёта.');
            draft.receipt = receipt; return receipt;
          }).finally(() => { draft.pending = null; });
      }
      return draft.pending;
    },
    discard(id) { if (!drafts.get(id)?.pending) drafts.delete(id); },
  };
}

async function sendSupportReport(payload) {
  try {
    const response = await fetch(SUPPORT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
  } catch { throw new Error('Не удалось отправить отчёт. Сохраните файл или повторите отправку; новый отчёт создавать не нужно.'); }
}
