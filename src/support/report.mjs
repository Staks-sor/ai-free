import { PNG } from 'pngjs';

export const SUPPORT_CONSENT_VERSION = '2026-11-10';
export const SUPPORT_MAX_BODY = 3_000_000;
export const SUPPORT_RETENTION_DAYS = 30;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PROVIDERS = ['qwen', 'deepseek', 'chatgpt', 'googleai', 'glm', 'codex', 'antigravity'];
const pick = (value, allowed) => allowed.includes(value) ? value : '';
const identifier = (value, length = 100) => /^[a-zA-Z0-9_.:-]+$/.test(String(value || '')) ? String(value).slice(0, length) : '';
const numeric = value => Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 1_000_000_000) : undefined;

export function redactSupportText(value, limit = 16000) {
  return String(value || '').slice(0, limit)
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer <redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<redacted>')
    .replace(/\b(?:authorization|cookies?|password|secret|(?:access_?|refresh_?|user_?|session_?)?token|api_?key|license_?key)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '<redacted>')
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}/g, '<redacted>')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}|\b[A-Za-z0-9_-]{43,}\b/g, '<redacted>')
    .replace(/https?:\/\/[^\s<>"']+/gi, '<url>')
    .replace(/[A-Za-z]:\\[^\r\n<>"']*|\\\\[^\r\n<>"']*|\/(?:Users|home|var|tmp|private|mnt)\/[^\s<>"']*/g, '<path>')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

export function supportErrorCode(value) {
  return String(value || '').match(/\b(?:QWEN|CAMOUFOX|DEEPSEEK|CHATGPT|GLM|GOOGLEAI|STATE|ERR|ECONN|ETIMEDOUT|ENOTFOUND)[A-Z0-9_]{0,75}\b/)?.[0] || '';
}

export function supportEvent(entry = {}) {
  const data = entry.data || entry;
  return Object.fromEntries(Object.entries({
    time: Number.isFinite(Date.parse(entry.timestamp || entry.time)) ? new Date(entry.timestamp || entry.time).toISOString() : '',
    component: identifier(entry.component, 50), event: identifier(entry.event, 70),
    provider: pick(data.provider, PROVIDERS), code: supportErrorCode(entry.error?.code || data.code),
    phase: pick(data.phase, ['runtime', 'python', 'package', 'browser', 'login', 'captcha', 'closing', 'ready', 'navigate', 'send', 'response']),
    resource: pick(data.resource, ['qwen-app', 'qwen-sdk', 'qwen-api', 'deepseek-app', 'deepseek-captcha']),
    reason: pick(data.reason, ['timeout', 'dns', 'tls', 'aborted', 'network', 'http']),
    captchaResult: pick(data.captchaResult, ['passed', 'rejected', 'unknown']),
    ...(Array.isArray(data.captchaErrorCodes) ? { captchaErrorCodes: data.captchaErrorCodes.filter(code => [
      'missing-input-secret', 'invalid-input-secret', 'missing-input-response', 'invalid-input-response', 'bad-request',
      'invalid-or-already-seen-response', 'not-using-dummy-passcode', 'sitekey-secret-mismatch', 'response-already-used', 'timeout-or-duplicate',
    ].includes(code)).slice(0, 10) } : {}),
    ...Object.fromEntries(['documentReady', 'appScriptPresent', 'sdkInitialized', 'deviceTokenPresent'].filter(key => typeof data[key] === 'boolean').map(key => [key, data[key]])),
    status: numeric(data.status || data.statusCode), durationMs: numeric(data.durationMs),
  }).filter(([, value]) => value !== undefined && value !== ''));
}

function screenshot(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2_100_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value)) throw new Error('Invalid screenshot');
  const bytes = Buffer.from(value.split(',')[1], 'base64');
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid screenshot');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 1600 || height > 1600 || width * height > 2_560_000) throw new Error('Oversized screenshot');
  try {
    // Re-encode pixels only: never retain EXIF/text/foreign metadata chunks.
    const png = PNG.sync.read(bytes, { checkCRC: true });
    const encoded = PNG.sync.write({ width: png.width, height: png.height, data: png.data });
    if (encoded.length > 1_500_000) throw new Error('Oversized screenshot');
    return 'data:image/png;base64,' + encoded.toString('base64');
  } catch { throw new Error('Invalid screenshot'); }
}

export function normalizeSupportReport(input = {}) {
  if (input.schema !== 1 || !UUID.test(input.id || '') || !Number.isFinite(Date.parse(input.createdAt))) throw new Error('Invalid report');
  const d = input.diagnostics || {}, app = d.app || {}, system = d.system || {}, runtime = d.runtime || {}, failure = d.failure || {};
  return {
    schema: 1, id: input.id.toLowerCase(), createdAt: new Date(input.createdAt).toISOString(),
    description: redactSupportText(input.description), contact: redactSupportText(input.contact, 200), screenshot: screenshot(input.screenshot),
    diagnostics: {
      app: { version: identifier(app.version, 40), build: /^[a-f0-9]{64}$/.test(app.build || '') ? app.build : '',
        surface: pick(app.surface, ['desktop', 'vscode', 'jetbrains']), node: identifier(app.node, 40),
        extensionVersion: identifier(app.extensionVersion, 40), ideVersion: identifier(app.ideVersion, 60) },
      system: { platform: pick(system.platform, ['win32', 'darwin', 'linux']), release: identifier(system.release, 70), arch: pick(system.arch, ['x64', 'arm64', 'ia32', 'arm']) },
      runtime: { python: identifier(runtime.python, 40), camoufox: identifier(runtime.camoufox, 40), browserPhase: pick(runtime.browserPhase, ['idle', 'runtime', 'python', 'package', 'browser', 'login', 'closing', 'ready', 'error']) },
      failure: { provider: pick(failure.provider, PROVIDERS), model: identifier(failure.model), code: supportErrorCode(failure.code) },
      events: Array.isArray(d.events) ? d.events.slice(-60).map(supportEvent) : [],
    },
  };
}
