import { error } from '@sveltejs/kit';
import { guides } from '$lib/content/guides.js';

export function entries() {
  return guides.map(({ slug }) => ({ slug }));
}

/** @type {import('./$types').PageLoad} */
export function load({ params }) {
  const guide = guides.find((item) => item.slug === params.slug);
  if (!guide) error(404, 'Материал не найден');
  return { guide };
}
