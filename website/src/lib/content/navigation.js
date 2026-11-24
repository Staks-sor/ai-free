export function siteNavigation(pathname = '/', hash = '') {
  const english = pathname === '/en' || pathname.startsWith('/en/');
  const base = english ? '/en' : '';
  const route = english ? pathname.slice(3) || '/' : pathname;
  return {
    english, home: base + '/', download: base + '/#download',
    alternate: (english ? route : '/en' + route) + hash,
    items: [
      { label: english ? 'Product' : 'Продукт', href: base + '/#product' },
      { label: english ? 'Updates' : 'Обновления', href: base + '/updates/' },
      { label: english ? 'Documents' : 'Документы', href: base + '/documents/' },
      { label: english ? 'Instructions' : 'Инструкция', href: base + '/instructions/' },
    ],
  };
}
