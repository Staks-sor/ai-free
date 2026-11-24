<script>
  import { createCommercialContent } from '$lib/content/commercial.js';
  const commercial = createCommercialContent(import.meta.env);
  const legal = commercial.legal;
</script>

<svelte:head>
  <title>Документы и данные — SYNVOX</title>
  <meta name="description" content="Оферта, политика обработки персональных данных, возвраты и удаление аккаунта SYNVOX." />
  <link rel="canonical" href="https://synvox.pro/documents/" />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="ru_RU" />
  <meta property="og:site_name" content="SYNVOX" />
  <meta property="og:title" content="Документы и данные — SYNVOX" />
  <meta property="og:description" content="Оферта, политика обработки персональных данных, возвраты и удаление аккаунта SYNVOX." />
  <meta property="og:url" content="https://synvox.pro/documents/" />
  <meta property="og:image" content="https://synvox.pro/images/og-synvox.jpg" />
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<main id="main" class="documents-page">
  <section class="documents-hero section-shell">
    <p class="section-index">SYNVOX · LEGAL</p>
    <h1>Документы и данные</h1>
    <p class="documents-lead">Архив условий для ранее оплаченных периодов, обработка персональных данных и контакты.</p>
    <div class="draft-callout" role="note">
      <strong>SYNVOX распространяется бесплатно для личного использования</strong>
      <span>Активация, оплата, продление и новые подписки отключены. Материалы ниже сохранены как правовой архив для обращений по прежним оплатам; они не являются предложением купить SYNVOX.</span>
    </div>
    <div class="alpha-callout">
      <strong>Альфа-продукт в разработке</strong>
      <span>Функции и интерфейс SYNVOX будут меняться. Существенные изменения условий сообщаются до их применения.</span>
    </div>
    {#if !legal.operatorComplete}
      <div class="draft-callout" role="status">
        <strong>Проекты документов</strong>
        <span>Документы не вводятся в действие и оплата не запускается до публикации полных реквизитов Оператора.</span>
      </div>
    {/if}
    <p class="documents-meta">Редакция {legal.version} · {legal.operator.name}</p>
  </section>

  <section id="contacts" class="seller-details section-shell" aria-labelledby="seller-title">
    <h2 id="seller-title">Исполнитель и контакты</h2>
    <dl>
      <div><dt>ФИО</dt><dd>{legal.operator.name}</dd></div>
      <div><dt>Статус</dt><dd>{legal.operator.status}</dd></div>
      <div><dt>ИНН</dt><dd>{legal.operator.inn}</dd></div>
      {#if commercial.address}<div><dt>Город / адрес</dt><dd>{commercial.address}</dd></div>{/if}
      {#if !legal.operator.ogrn.startsWith('Не применяется')}<div><dt>ОГРН / ОГРНИП</dt><dd>{legal.operator.ogrn}</dd></div>{/if}
      <div><dt>Поддержка, претензии и персональные данные</dt><dd>{#if commercial.email}<a href={'mailto:' + commercial.email}>{commercial.email}</a>{/if} · <a href={commercial.telegram}>Telegram @Staks_sor</a></dd></div>
    </dl>
    <p>По вопросу прежней оплаты укажите номер заказа и дату платежа. Не отправляйте пароль, секретный ключ доступа, полный номер карты или CVV.</p>
  </section>

  <section class="documents-list section-shell" aria-label="Юридические документы SYNVOX">
    {#each legal.docs as doc, index}
      <details id={doc.id} class="public-document" open={index === 0 || doc.id === 'offer' || doc.id === 'refunds'}>
        <summary>
          <span><small>{String(index + 1).padStart(2, "0")}</small><strong>{doc.title}</strong></span>
          <p>{doc.summary}</p>
          <i aria-hidden="true">+</i>
        </summary>
        <div class="public-document-body">
          {#each doc.sections as section}
            <section>
              <h2>{section[0]}</h2>
              <p>{section[1]}</p>
            </section>
          {/each}
        </div>
      </details>
    {/each}
  </section>
</main>
