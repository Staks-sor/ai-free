import { verifyAccess } from './verify.mjs';

export function createAccessGuard({ enabled = false, publicKey, version, installationId, fetchProof, now = Date.now }) {
  let cached, cachedAt = 0, fetchInFlight;
  return async () => {
    if (!enabled) return { allowed: true, reason: 'disabled' };
    let access;
    const checkedAt = now();
    if (cached && checkedAt - cachedAt < 60000) {
      try { access = verifyAccess(cached, publicKey, { now: checkedAt, version, installationId }); }
      catch { /* An expired cached proof must be refreshed before access is decided. */ }
    }
    if (!access) {
      let proof;
      let refreshed = false;
      try {
        if (!fetchInFlight) {
          fetchInFlight = Promise.resolve().then(fetchProof);
          fetchInFlight.finally(() => { fetchInFlight = null; }).catch(() => {});
        }
        proof = await fetchInFlight;
        refreshed = true;
      } catch {
        proof = cached;
      }
      try { access = verifyAccess(proof, publicKey, { now: now(), version, installationId }); }
      catch { throw Object.assign(new Error('license_unavailable: проверьте подключение или активируйте ключ'), { status: 503 }); }
      if (refreshed) {
        cached = proof;
        cachedAt = now();
      }
    }
    if (!access.allowed) throw Object.assign(new Error(`${access.reason}: откройте подписку или обновите SYNVOX`), { status: access.reason === 'update_required' ? 426 : 402 });
    return access;
  };
}

// SYNVOX is distributed as a free local client. Keep this export for older
// entry points without creating an installation or contacting a license API.
export async function assertLicensedAccess() {
  return { allowed: true, reason: 'free_release' };
}
