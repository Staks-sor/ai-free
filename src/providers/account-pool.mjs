import { accountActivity } from './activity-session.mjs';

const sharedProviders = new Set(['qwen', 'deepseek', 'glm', 'chatgpt', 'googleai']);

export function createProviderAccountPool({ now = () => Date.now(), activity = accountActivity } = {}) {
  const providers = new Map();
  const leases = new Map();
  const affinity = new Map();
  let sequence = 0;

  function register(providerId, adapter) {
    const id = String(providerId || "").trim();
    if (!id) throw new TypeError("providerId is required");
    if (typeof adapter?.listAccounts !== "function") {
      throw new TypeError("adapter.listAccounts must be a function");
    }
    providers.set(id, adapter);
  }

  async function list(providerId) {
    const adapter = providers.get(providerId);
    if (!adapter) return [];
    const accounts = await adapter.listAccounts();
    return Array.isArray(accounts) ? accounts.filter((account) => account?.id) : [];
  }

  function activeCount(providerId, accountId) {
    let count = 0;
    for (const lease of leases.values()) {
      if (lease.providerId === providerId && lease.accountId === accountId) count += 1;
    }
    return count;
  }

  function isAvailable(providerId, account, timestamp) {
    if (!account || account.invalid === true || account.disabled === true || account.limited === true) return false;
    if (account.resetAt && new Date(account.resetAt).getTime() > timestamp) return false;
    if (sharedProviders.has(providerId) && activity.isBusy(providerId, account.id, { otherProcessOnly: true })) return false;
    const maxConcurrency = Math.max(1, Number(account.maxConcurrency) || 1);
    return activeCount(providerId, account.id) < maxConcurrency;
  }

  async function lease(providerId, { affinityKey = "", preferredId: requestedId = null, excludeIds = [] } = {}) {
    const timestamp = now();
    const accounts = (await list(providerId)).filter((account) => !excludeIds.includes(account.id) && isAvailable(providerId, account, timestamp));
    if (!accounts.length) return null;

    const providerAffinity = affinity.get(providerId) || new Map();
    affinity.set(providerId, providerAffinity);
    const preferredId = requestedId || (affinityKey ? providerAffinity.get(String(affinityKey)) : null);
    const preferred = preferredId ? accounts.find((account) => account.id === preferredId) : null;
    const account = preferred || [...accounts].sort((left, right) => {
      const primaryDelta = Number(right.primary === true) - Number(left.primary === true);
      if (primaryDelta) return primaryDelta;
      const loadDelta = activeCount(providerId, left.id) - activeCount(providerId, right.id);
      if (loadDelta) return loadDelta;
      const usedDelta = Number(left.lastUsed || 0) - Number(right.lastUsed || 0);
      return usedDelta || String(left.id).localeCompare(String(right.id));
    })[0];

    if (affinityKey) providerAffinity.set(String(affinityKey), account.id);
    let releaseActivity;
    try { if (sharedProviders.has(providerId)) releaseActivity = activity.acquire(providerId, account.id); }
    catch (error) { if (error.code === 'ACCOUNT_BUSY') return null; throw error; }
    const leaseId = `${providerId}:${account.id}:${++sequence}`;
    leases.set(leaseId, { providerId, accountId: account.id, startedAt: timestamp });
    let released = false;
    return {
      id: leaseId,
      providerId,
      account,
      release() {
        if (released) return false;
        releaseActivity?.();
        released = true;
        return leases.delete(leaseId);
      },
    };
  }

  async function snapshot(providerId) {
    const adapter = providers.get(providerId);
    if (!adapter) return [];
    const accounts = await adapter.listAccounts();
    if (!Array.isArray(accounts)) return [];
    const timestamp = now();
    return accounts.map((account) => {
      const activeLeases = activeCount(providerId, account.id);
      return {
        id: account.id,
        busy: activeLeases > 0 || (sharedProviders.has(providerId) && activity.isBusy(providerId, account.id, { otherProcessOnly: true })),
        activeLeases,
        available: isAvailable(providerId, account, timestamp),
        invalid: account.invalid === true,
        resetAt: account.resetAt || null,
      };
    });
  }

  return Object.freeze({ register, lease, snapshot });
}
