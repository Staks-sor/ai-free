export async function handle({ event, resolve }) {
  const language = event.url.pathname.startsWith('/en/') ? 'en' : 'ru';
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('<html lang="ru">', `<html lang="${language}">`),
  });
}
