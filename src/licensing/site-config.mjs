// Compatibility data for older callers. Subscription metadata is no longer
// fetched because SYNVOX is free and needs no commercial control plane.
export async function getSiteSubscriptionConfig() {
  return { source: 'local', paymentEnabled: false };
}
