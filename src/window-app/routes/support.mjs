import { createSupportDrafts } from '../../support/client.mjs';
import { SUPPORT_MAX_BODY } from '../../support/report.mjs';

export function createSupportRoutes(options) {
  const drafts = createSupportDrafts(options);
  return async (req, res, url, { readBody, sendJson }) => {
    if (req.method === 'GET' && url.pathname === '/api/support/config') { sendJson(res, drafts.config()); return true; }
    if (req.method !== 'POST' || !['/api/support/drafts', '/api/support/send', '/api/support/discard'].includes(url.pathname)) return false;
    try {
      const body = await readBody(req, url.pathname === '/api/support/drafts' ? SUPPORT_MAX_BODY : 4096);
      if (url.pathname === '/api/support/drafts') sendJson(res, await drafts.prepare(body));
      else if (url.pathname === '/api/support/discard') { drafts.discard(body.draftId); sendJson(res, { ok: true }); }
      else sendJson(res, await drafts.submit(body));
    } catch (error) { sendJson(res, { error: error.message }, 400); }
    return true;
  };
}
