<script>
  import { guides } from '$lib/content/guides.js';
  /** @type {import('./$types').PageProps} */
  let { data } = $props();
  const guide = $derived(data.guide);
  const canonical = $derived(`https://synvox.pro/guides/${guide.slug}/`);
  const schema = $derived({ '@context': 'https://schema.org', '@type': 'Article', headline: guide.title, description: guide.description, inLanguage: 'ru', mainEntityOfPage: canonical, author: { '@type': 'Organization', name: 'SYNVOX', url: 'https://synvox.pro/' } });
</script>

<svelte:head>
  <title>{guide.title} — SYNVOX</title>
  <meta name="description" content={guide.description} />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <link rel="canonical" href={canonical} />
  <meta property="og:type" content="article" />
  <meta property="og:locale" content="ru_RU" />
  <meta property="og:site_name" content="SYNVOX" />
  <meta property="og:title" content={`${guide.title} — SYNVOX`} />
  <meta property="og:description" content={guide.description} />
  <meta property="og:url" content={canonical} />
  <meta property="og:image" content="https://synvox.pro/images/og-synvox.jpg" />
  <meta name="twitter:card" content="summary_large_image" />
  {@html `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`}
</svelte:head>

<main id="main" class="guide-page section-shell">
  <nav class="guide-breadcrumb" aria-label="Хлебные крошки"><a href="/">SYNVOX</a><span aria-hidden="true"> / </span><a href="/#guides">Материалы об AI</a></nav>
  <article>
    <p class="section-index">ПРАКТИКА · SYNVOX</p>
    <h1>{guide.title}</h1>
    <p class="guide-lead">{guide.lead}</p>
    <p class="guide-byline">Материал SYNVOX · Альфа-продукт в разработке</p>
    {#each guide.sections as section}
      <section class="guide-section"><h2>{section.title}</h2><p>{section.text}</p></section>
    {/each}
    <section class="guide-example"><h2>Пример задачи для AI</h2><blockquote>{guide.example}</blockquote><p>Это пример постановки задачи, а не отчёт о выполненной работе.</p></section>
    <section class="guide-section"><h2>Частые вопросы</h2>
      {#each guide.questions as item}<details class="guide-question"><summary>{item.q}</summary><p>{item.a}</p></details>{/each}
    </section>
  </article>
  <aside class="guide-section" aria-label="Дальше по теме"><h2>Другие материалы</h2>
    {#each guides.filter((item) => item.slug !== guide.slug) as item}<a class="guide-related" href={`/guides/${item.slug}/`}>{item.title} <span aria-hidden="true">↗</span></a>{/each}
  </aside>
  <div class="guide-actions"><a class="button button-primary" href="/#download">Скачать SYNVOX бесплатно</a><a class="button button-quiet" href="/documents/">Правовой архив</a></div>
</main>
