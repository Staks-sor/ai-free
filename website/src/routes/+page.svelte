<script>
  import { guides } from '$lib/content/guides.js';
  import {
    benefits,
    downloadPlatforms,
    providers,
    releaseState,
    site,
  } from "$lib/content/site.js";

  let glowX = $state(50);
  let glowY = $state(45);

  /** @param {PointerEvent & { currentTarget: HTMLElement }} event */
  function moveGlow(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    glowX = ((event.clientX - rect.left) / rect.width) * 100;
    glowY = ((event.clientY - rect.top) / rect.height) * 100;
  }

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "SYNVOX",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS, Windows, Linux",
    description: site.description,
    url: site.url,
    image: `${site.url}/images/og-synvox.jpg`,
  };
</script>

<svelte:head>
  <meta name="google-site-verification" content="M8dQFGrwM9C04Cdirq12DFTQm5llftcc1CbSuwoXcgM" />
  <meta name="msvalidate.01" content="31187E33E4A055689ED50844AF522F26" />
  <title>SYNVOX — AI-помощник для программирования</title>
  <meta name="description" content={site.description} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <link rel="canonical" href={`${site.url}/`} />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="ru_RU" />
  <meta property="og:site_name" content="SYNVOX" />
  <meta property="og:title" content="SYNVOX — AI-помощник для программирования" />
  <meta property="og:description" content={site.description} />
  <meta property="og:url" content={`${site.url}/`} />
  <meta property="og:image" content={`${site.url}/images/og-synvox.jpg`} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="SYNVOX — локальное AI-пространство для разработки" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="SYNVOX — AI-помощник для программирования" />
  <meta name="twitter:description" content={site.description} />
  <meta name="twitter:image" content={`${site.url}/images/og-synvox.jpg`} />
  {@html `<script type="application/ld+json">${JSON.stringify(structuredData).replace(/</g, '\\u003c')}</script>`}
</svelte:head>

<main id="main">
  <section
    class="hero"
    aria-labelledby="hero-title"
    onpointermove={moveGlow}
    style={`--glow-x:${glowX}%;--glow-y:${glowY}%`}
  >
    <img class="hero-background" src="/images/hero-pearl-sharp.png" alt="" width="1774" height="887" />
    <div class="hero-grid" aria-hidden="true"></div>
    <div class="hero-glow" aria-hidden="true"></div>

    <div class="hero-content">
      <img class="hero-lockup" src="/images/synvox-lockup-transparent.png" alt="SYNVOX" width="768" height="720" />
      <h1 id="hero-title">{site.title}</h1>
      <p class="hero-copy">{site.description}</p>
      <div class="hero-actions">
        <a class="button button-primary" href={site.primaryCta.href}>{site.primaryCta.label}<span aria-hidden="true">↓</span></a>
      </div>
    </div>
  </section>

  <section class="product-section section-shell" id="product" aria-labelledby="product-title">
    <div class="section-heading split-heading">
      <p class="section-index">ПРОДУКТ</p>
      <div>
        <h2 id="product-title">Не переносите проект в чат.<br />Подключите AI к проекту.</h2>
        <p>SYNVOX работает рядом с кодом — в VS Code, PyCharm или отдельном приложении.</p>
      </div>
    </div>

    <div class="benefit-grid">
      {#each benefits as benefit}
        <article class="benefit-card">
          <span>{benefit.number}</span>
          <h3>{benefit.title}</h3>
          <p>{benefit.description}</p>
        </article>
      {/each}
    </div>

    <div class="trust-panel" aria-label="Ключевые отличия SYNVOX">
      <div class="trust-item">
        <small>ВАШИ AI</small>
        <p>{providers.join(" · ")}</p>
        <span>Один проект и одна память — какой бы AI вы ни выбрали.</span>
      </div>
      <div class="trust-item trust-local">
        <small>ВАШИ ДАННЫЕ</small>
        <p>{site.localPromise}</p>
        <span>SYNVOX не переносит рабочую память проекта в своё облако.</span>
      </div>
      <p class="team-note"><strong>Большая задача?</strong> SYNVOX может разделить её между несколькими помощниками и собрать общий результат.</p>
    </div>
  </section>

  <section class="updates-teaser section-shell" aria-labelledby="updates-title">
    <div class="section-heading split-heading">
      <p class="section-index">ОБНОВЛЕНИЯ</p>
      <div>
        <h2 id="updates-title">Все версии.<br />В одном месте.</h2>
      </div>
    </div>
    <a class="release-row" href="/updates">
      <span class="release-number">001</span>
      <div><small>{releaseState.label}</small><strong>{releaseState.title}</strong></div>
      <p>{releaseState.message}</p>
      <i aria-hidden="true">↗</i>
    </a>
  </section>

  <section id="guides" class="guides-section section-shell" aria-labelledby="guides-title">
    <div class="section-heading split-heading"><p class="section-index">ПРАКТИКА</p><div><h2 id="guides-title">AI для работы с кодом<br />и командой агентов.</h2><p>Как поставить задачу, передать контекст и проверить результат.</p></div></div>
    <div class="guide-card-grid">{#each guides as guide}<a class="guide-card" href={`/guides/${guide.slug}/`}><h3>{guide.title}</h3><p>{guide.description}</p><span>Читать материал ↗</span></a>{/each}</div>
  </section>

  <section class="download-section" id="download" aria-labelledby="download-title">
    <div class="download-halo" aria-hidden="true"></div>
    <div class="download-inner section-shell">
      <p class="section-index">SYNVOX</p>
      <h2 id="download-title">SYNVOX на вашем компьютере.</h2>
      <p><strong>Бесплатно для личного использования.</strong> Активация и подписка не требуются. Один архив для macOS, Windows и Linux. Альфа-версия 0.5.65.</p>
      <div class="guide-actions"><a class="button button-primary" href="/downloads/synvox-desktop-0.5.65.zip" download>Скачать SYNVOX 0.5.65 · ZIP</a><a class="button button-quiet" href="/instructions/">Инструкция по установке</a></div>
      <div class="ide-downloads"><strong>Плагины для IDE</strong><a href="/downloads/synvox-vscode-0.5.65.vsix" download>VS Code 0.5.65 ↓</a><a href="/downloads/synvox-jetbrains-0.5.65.zip" download>PyCharm 0.5.65 ↓</a></div>
      <div class="platform-list">
        {#each downloadPlatforms as platform}
          <div>
            <span><strong>{platform.name}</strong><small>{platform.detail}</small></span>
            <a href="/instructions/">Node.js · инструкция ↗</a>
          </div>
        {/each}
      </div>
      <p class="download-note">Требуется Node.js 22 или новее. Это не готовый установщик. <a href="/en/instructions/">Installation guide in English</a></p>
    </div>
  </section>
</main>
