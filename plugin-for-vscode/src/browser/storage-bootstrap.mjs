import fs from 'node:fs';

// A persistent context cannot consume Playwright's storageState option.
// Seed a new profile once; an existing profile owns its newer session data.
export function readInitialStorageState(profileDir, storageStatePath) {
  if (!profileDir || !storageStatePath || !fs.existsSync(storageStatePath)) return null;
  if (fs.existsSync(profileDir) && fs.readdirSync(profileDir).length) return null;
  return JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
}

export async function restoreInitialStorageState(context, state) {
  if (!state) return;
  if (state.cookies?.length) await context.addCookies(state.cookies);
  if (state.origins?.length) {
    await context.addInitScript(({ origins }) => {
      const saved = origins.find(entry => entry.origin === location.origin);
      for (const { name, value } of saved?.localStorage || []) {
        if (localStorage.getItem(name) === null) localStorage.setItem(name, value);
      }
    }, { origins: state.origins });
  }
}
