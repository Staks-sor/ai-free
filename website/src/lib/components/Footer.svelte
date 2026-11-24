<script>
  import { createCommercialContent } from '$lib/content/commercial.js';
  const commercial = createCommercialContent(import.meta.env);
</script>

<footer class="site-footer">
  <div>
    <div class="footer-brand">
      <img class="footer-symbol" src="/images/synvox-mark-transparent.png" alt="" width="256" height="256" loading="lazy" />
      <img class="footer-wordmark" src="/images/synvox-wordmark-transparent.png" alt="SYNVOX" width="512" height="80" loading="lazy" />
    </div>
    <p>AI-пространство для работы.</p>
    <p>{commercial.legal.operator.name}<br />{commercial.legal.operator.status}<br />ИНН {commercial.legal.operator.inn} · {commercial.address}</p>
    {#if commercial.email}<a href={'mailto:' + commercial.email}>{commercial.email}</a>{/if}
  </div>
  <div class="footer-links">
    <a href="/#product">Продукт</a>
    <a href="/#guides">Материалы об AI</a>
    <a href="/updates">Обновления</a>
    <a href="/documents">Документы</a>
    <a href="/instructions/">Инструкция</a>
    <a href="/#download">Скачать SYNVOX 0.5.65</a>
    <a href="/documents/">Правовой архив и контакты</a>
  </div>
  <p class="footer-meta">© {new Date().getFullYear()} SYNVOX</p>
</footer>
