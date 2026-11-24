const supported = new Set(['qwen', 'deepseek', 'chatgpt', 'glm', 'googleai']);
export async function handleAccountRequest(req, res, url, { qwen, web, sendJson, readBody }) {
  const match = url.pathname.match(/^\/api\/accounts\/([^/]+)$/);
  if (!match) return false;
  const provider = match[1], host = String(req.headers.host || '');
  const reply = (body, status) => sendJson(res, body, status);
  if (!supported.has(provider)) { await reply({ error: 'Unknown provider' }, 404); return true; }
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) { await reply({ error: 'Invalid host' }, 403); return true; }
  try {
    if (req.method === 'GET') await reply(provider === 'qwen' ? await qwen.snapshot() : await web.snapshot(provider));
    else if (req.method === 'POST') {
      if (req.headers.origin !== 'http://' + host || !String(req.headers['content-type'] || '').startsWith('application/json')) {
        await reply({ error: 'Invalid origin' }, 403); return true;
      }
      const body = await readBody(req, 4096);
      await reply(provider === 'qwen' ? await qwen.action(body) : await web.action(provider, body));
    } else await reply({ error: 'Method not allowed' }, 405);
  } catch (error) { await reply({ error: error.message || 'Account error', code: error.code }, 400); }
  return true;
}
