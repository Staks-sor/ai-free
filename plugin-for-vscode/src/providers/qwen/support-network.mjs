import { createFileLogger } from '../../logging/logger.mjs';

const logger = createFileLogger({ component: 'qwen-network' });
export function logQwenRuntimeNotReady(runtime, log = logger) {
  const data = { provider: 'qwen', phase: 'browser', code: 'QWEN_RUNTIME_NOT_READY' };
  for (const key of ['documentReady', 'appScriptPresent', 'sdkInitialized', 'deviceTokenPresent']) {
    if (typeof runtime?.[key] === 'boolean') data[key] = runtime[key];
  }
  log.warn('runtime.not_ready', data);
}
function resource(value) {
  try {
    const url = new URL(value);
    if (url.hostname === 'assets.alicdn.com') return url.pathname.includes('qwen-chat-fe') ? 'qwen-app' : 'qwen-sdk';
    if (url.origin === 'https://chat.qwen.ai') return url.pathname.startsWith('/api/') ? 'qwen-api' : 'qwen-app';
  } catch {}
  return '';
}

export function attachQwenSupportDiagnostics(page, log = logger) {
  page.on('response', response => {
    const name = resource(response.url()), status = response.status();
    if (!name || status < 400) return;
    log.warn('resource.http_error', { provider: 'qwen', resource: name, status, reason: 'http' });
  });
  page.on('requestfailed', request => {
    const name = resource(request.url()); if (!name) return;
    const failure = request.failure()?.errorText || '';
    const reason = /TIMEOUT|TIMED_OUT/i.test(failure) ? 'timeout' : /DNS|NAME_NOT_RESOLVED|UNKNOWN_HOST/i.test(failure) ? 'dns'
      : /SSL|TLS|CERT/i.test(failure) ? 'tls' : /ABORT/i.test(failure) ? 'aborted' : 'network';
    log.warn('resource.request_failed', { provider: 'qwen', resource: name, reason });
  });
}
