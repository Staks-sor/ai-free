import fs from 'node:fs';
import { INSTALLATION_FILE } from './installation.mjs';
import { verifyAccess } from './verify.mjs';
import { AI_FREE_VERSION } from '../config.mjs';

export async function liveInstallationStatus() {
  if (!fs.existsSync(INSTALLATION_FILE)) return {};
  try {
    const identity = JSON.parse(fs.readFileSync(INSTALLATION_FILE, 'utf8'));
    const response = await fetch('https://synvox.pro/v1/license/status', { headers: { Authorization: 'Bearer ' + identity.key }, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Unavailable');
    const access = verifyAccess(await response.json(), fs.readFileSync(new URL('./merchant-public.pem', import.meta.url)), { version: AI_FREE_VERSION, installationId: identity.id });
    return { installationId: access.installationId, installationAccessUntil: access.accessUntil, installationState: access.reason };
  } catch { return { installationState: 'unavailable' }; }
}
