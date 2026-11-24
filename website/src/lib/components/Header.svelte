<script>
  import { page } from '$app/state';
  import { siteNavigation } from '$lib/content/navigation.js';
  const nav = $derived(siteNavigation(page.url.pathname, page.url.hash));
  let menuOpen = $state(false);
</script>

<header class="site-header">
  <a class="wordmark" href={nav.home} aria-label={nav.english ? 'SYNVOX — home' : 'SYNVOX — на главную'}>
    <img class="wordmark-symbol" src="/images/synvox-mark-transparent.png" alt="" width="256" height="256" />
    <img class="wordmark-name" src="/images/synvox-wordmark-transparent.png" alt="SYNVOX" width="512" height="80" />
  </a>

  <nav class="desktop-nav" aria-label={nav.english ? 'Primary navigation' : 'Основная навигация'}>
    {#each nav.items as item}
      <a href={item.href} aria-current={page.url.pathname === item.href ? 'page' : undefined}>{item.label}</a>
    {/each}
    <a href={nav.alternate} lang={nav.english ? 'ru' : 'en'}>{nav.english ? 'RU' : 'EN'}</a>
  </nav>

  <a class="header-cta" href={nav.download}>{nav.english ? 'Download' : 'Скачать'} <span aria-hidden="true">↗</span></a>

  <details class="mobile-menu" bind:open={menuOpen}>
    <summary aria-label={nav.english ? 'Open menu' : 'Открыть меню'}><span></span><span></span></summary>
    <nav aria-label={nav.english ? 'Mobile navigation' : 'Мобильная навигация'}>
      {#each nav.items as item}
        <a href={item.href} onclick={() => menuOpen = false}>{item.label}</a>
      {/each}
      <a href={nav.alternate} lang={nav.english ? 'ru' : 'en'} onclick={() => menuOpen = false}>{nav.english ? 'Русский' : 'English'}</a>
      <a href={nav.download} onclick={() => menuOpen = false}>{nav.english ? 'Download SYNVOX' : 'Скачать SYNVOX'}</a>
    </nav>
  </details>
</header>
