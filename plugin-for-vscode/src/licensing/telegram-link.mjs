import { ensureInstallation } from './installation.mjs';

export async function createTelegramLink({ identityPath, endpoint = 'https://synvox.pro', fetchImpl = fetch } = {}) {
  const identity = await ensureInstallation({ identityPath, endpoint, fetchImpl });
  const response = await fetchImpl(new URL('/v1/license/telegram', endpoint), {
    method: 'POST', headers: { Authorization: 'Bearer ' + identity.key, 'Content-Type': 'application/json' }, body: '{}',
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Не удалось создать ссылку Telegram. Повторите позже.');
  const data = await response.json();
  if (!/^https:\/\/t\.me\/Synvox_bot\?start=[A-Za-z0-9_-]{32}$/.test(data.url)) throw new Error('Некорректная ссылка оплаты');
  return { url: data.url, installationId: identity.id };
}
