import { verify } from 'node:crypto';

export function versionParts(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) throw new Error('Invalid client version');
  return value.split('.').map(Number);
}
function older(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i];
  return false;
}
export function verifyAccess(proof, publicKey, { now = Date.now(), version, installationId } = {}) {
  if (!proof || typeof proof.payload !== 'string' || typeof proof.signature !== 'string' ||
      !verify(null, Buffer.from(proof.payload), publicKey, Buffer.from(proof.signature, 'base64url'))) throw new Error('Invalid license signature');
  const claims = JSON.parse(Buffer.from(proof.payload, 'base64url').toString());
  if (claims.audience !== 'synvox' || (installationId && installationId !== claims.installationId) ||
      !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt) || !Number.isSafeInteger(claims.accessUntil) ||
      claims.issuedAt > now + 60000 || claims.expiresAt <= now || claims.expiresAt - claims.issuedAt > 86400000) throw new Error('Invalid or expired license');
  const reason = claims.revoked ? 'revoked' : older(version, claims.minimumVersion) ? 'update_required' : now >= claims.accessUntil ? 'payment_required' : 'active';
  return { ...claims, reason, allowed: reason === 'active' };
}
