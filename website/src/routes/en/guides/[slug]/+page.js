import { error } from '@sveltejs/kit';
import { englishGuides } from '$lib/content/guides-en.js';
export function entries() { return englishGuides.map(({ slug }) => ({ slug })); }
export function load({ params }) { const guide = englishGuides.find((item) => item.slug === params.slug); if (!guide) error(404, 'Guide not found'); return { guide }; }
