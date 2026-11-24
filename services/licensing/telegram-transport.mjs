export async function createTelegramTransport(proxyUrl = '', { fetch = globalThis.fetch, loadProxy = () => import('undici') } = {}) {
  let dispatcher;
  if (proxyUrl) {
    const url = new URL(proxyUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Loopback HTTP proxy required');
    }
    const { ProxyAgent } = await loadProxy();
    dispatcher = new ProxyAgent(proxyUrl);
  }
  return {
    async fetch(url, options) {
      if (new URL(url).origin !== 'https://api.telegram.org') throw new Error('Telegram origin required');
      return fetch(url, dispatcher ? { ...options, dispatcher } : options);
    },
    async close() { await dispatcher?.close(); },
  };
}
