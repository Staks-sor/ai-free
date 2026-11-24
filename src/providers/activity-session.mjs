import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAccountActivity } from './account-activity.mjs';

export const accountActivity = createAccountActivity();

export async function withAccountActivitySession(provider, id, factory) {
  const release = accountActivity.acquire(provider, id);
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    release();
    released = true;
  };

  try {
    const session = await factory();
    if (session == null) {
      releaseOnce();
      return session;
    }
    if (session?.context && typeof session.context.once === 'function') {
      session.context.once('close', releaseOnce);
    }
    if (session && typeof session.close === 'function') {
      const close = session.close;
      session.close = function (...args) {
        const result = Reflect.apply(close, this, args);
        if (result && typeof result.then === 'function') {
          return Promise.resolve(result).then(value => {
            releaseOnce();
            return value;
          });
        }
        releaseOnce();
        return result;
      };
    }
    return session;
  } catch (error) {
    releaseOnce();
    throw error;
  }
}

export function profileActivityId(profileDir) {
  return `profile_${createHash('sha256').update(path.resolve(profileDir)).digest('hex')}`;
}
