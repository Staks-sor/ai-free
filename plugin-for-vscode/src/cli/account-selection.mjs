import { DEFAULT_AUTH_FILE, DEFAULT_COOKIE_FILE } from '../config.mjs';
import { createWebAccountManager } from '../providers/web-account-manager.mjs';
import { createWebAccountAdapters } from '../providers/web-account-adapters.mjs';
export function selectCLIAccount(args, { manager = null, argv = [] } = {}) {
  if (args.window || args.token || args.authFile !== DEFAULT_AUTH_FILE || args.cookies !== DEFAULT_COOKIE_FILE
    || argv.includes('--cookies') || argv.includes('--auth-file')) return null;
  manager ||= createWebAccountManager({ adapters: createWebAccountAdapters() });
  return manager.selected('deepseek') === 'default' ? null : manager.resolve('deepseek');
}
