import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { AUTH_DIR } from '../config.mjs';

export const INSTALLATION_FILE = path.join(AUTH_DIR, 'synvox-installation.json');

// Keep identity outside the updater-managed application tree. Never replace corrupt keys.
export async function ensureInstallation({ identityPath = INSTALLATION_FILE, endpoint, fetchImpl = fetch }) {
  const base = new URL(endpoint);
  if (base.username || base.password || (base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === '127.0.0.1'))) throw new Error('HTTPS required');
  if (!path.isAbsolute(identityPath)) throw new Error('Absolute installation path required');
  if (!fs.existsSync(identityPath)) {
    fs.mkdirSync(path.dirname(identityPath), { recursive: true, mode: 0o700 });
    const temporary = identityPath + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify({ key: randomBytes(32).toString('base64url') }), { flag: 'wx', mode: 0o600 });
      try { fs.linkSync(temporary, identityPath); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  if (!identity || typeof identity.key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(identity.key)) throw new Error('Invalid installation identity; restore the original key');
  const response = await fetchImpl(new URL('/v1/license/register', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: identity.key }),
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Installation registration unavailable');
  const registered = await response.json();
  if (registered.key !== identity.key || typeof registered.id !== 'string' || !/^[\da-f-]{36}$/i.test(registered.id)
    || (identity.id && identity.id !== registered.id)) throw new Error('Invalid installation registration response');
  return { id: registered.id, key: identity.key };
}
