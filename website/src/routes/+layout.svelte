<script>
  import "../app.css";
  import Footer from "$lib/components/Footer.svelte";
  import Header from "$lib/components/Header.svelte";
  import FooterEn from '$lib/components/FooterEn.svelte';
  import { page } from '$app/state';
  import { afterNavigate } from '$app/navigation';
  const english = $derived(page.url.pathname.startsWith('/en/'));
  afterNavigate(() => { document.documentElement.lang = english ? 'en' : 'ru'; });

  let { children } = $props();
</script>

<a class="skip-link" href="#main">{english ? 'Skip to content' : 'К содержанию'}</a>
<Header />
{@render children()}
{#if english}<FooterEn />{:else}<Footer />{/if}
