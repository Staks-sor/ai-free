import { createAnnouncements } from '../../announcements/client.mjs';

export function createAnnouncementRoutes({ client = createAnnouncements() } = {}) {
  return async (req, res, url, { readBody, sendJson }) => {
    if (req.method === 'GET' && url.pathname === '/api/announcements') {
      try { sendJson(res, await client.list()); }
      catch { sendJson(res, { error: 'Не удалось прочитать объявления.' }, 503); }
      return true;
    }
    if (req.method !== 'POST' || url.pathname !== '/api/announcements/read') return false;
    try { sendJson(res, client.acknowledge((await readBody(req, 4096)).ids)); }
    catch { sendJson(res, { error: 'Не удалось сохранить прочтение объявления. Попробуйте ещё раз.' }, 400); }
    return true;
  };
}
