<script>
  import { releaseState, site } from "$lib/content/site.js";
</script>

<svelte:head>
  <title>Обновления — SYNVOX</title>
  <meta name="description" content="Официальный журнал версий, исправлений и обновлений SYNVOX." />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <link rel="canonical" href={`${site.url}/updates/`} />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="ru_RU" />
  <meta property="og:site_name" content="SYNVOX" />
  <meta property="og:title" content="Обновления — SYNVOX" />
  <meta property="og:description" content="Официальный журнал версий, исправлений и обновлений SYNVOX." />
  <meta property="og:url" content={`${site.url}/updates/`} />
  <meta property="og:image" content={`${site.url}/images/og-synvox.jpg`} />
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<main id="main" class="updates-page">
  <section class="updates-hero section-shell">
    <p class="eyebrow"><span></span>RELEASE NOTES</p>
    <h1>Журнал<br />SYNVOX.</h1>
    <p>Официальная история новых версий, исправлений и важных изменений продукта.</p>
  </section>

  <section class="release-archive section-shell" aria-labelledby="release-title">
    <div class="archive-index" aria-hidden="true">001</div>
    <article>
      <div class="release-meta"><span>{releaseState.label}</span><span>ALPHA · 0.5.65</span></div>
      <h2 id="release-title">{releaseState.title}</h2>
      <p>{releaseState.message}</p>
      <div class="release-rule"></div>
      <p class="release-detail">Ручная установка: скачайте ZIP и следуйте инструкции. Это альфа-версия, не нативный установщик. Автоматическое обновление этим архивом не включается.</p>
      <a class="button button-quiet" href="/#download">К загрузкам <span aria-hidden="true">↘</span></a>
    </article>
  </section>
</main>
