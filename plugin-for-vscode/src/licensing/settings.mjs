// Compatibility status for older local windows. No installation identity is
// inspected and no network check is performed in the free release.
export async function getSubscriptionStatus() {
  return { state: 'free_release', paymentEnabled: false };
}
