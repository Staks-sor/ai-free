import { ensureInstallation } from './installation.mjs';

export async function createRobokassaLink({ identityPath, endpoint = 'https://synvox.pro', fetchImpl = fetch } = {}) {
  const identity = await ensureInstallation({ identityPath, endpoint, fetchImpl });
  const response = await fetchImpl(new URL('/v1/license/robokassa/link', endpoint), {
    method: 'POST', headers: { Authorization: 'Bearer ' + identity.key, 'Content-Type': 'application/json' }, body: '{}',
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Robokassa пока недоступна. Повторите позже.');
  const data = await response.json();
  if (!/^https:\/\/synvox\.pro\/v1\/license\/robokassa\/checkout\?token=[A-Za-z0-9_-]{32}$/.test(data.url)) throw new Error('Некорректная ссылка оплаты');
  return { url: data.url, installationId: identity.id };
}
