export const ANNOUNCEMENTS_STYLES = `
.announcementsButton{position:relative;flex:none;min-width:36px;padding:8px!important}
.announcementsButton svg{display:block}.announcementsButton span{position:absolute;right:0;top:0;min-width:14px;height:14px;border-radius:9px;background:var(--accent,#6d82ee);color:#fff;font-size:10px;line-height:14px;text-align:center}
.announcementsButton [hidden]{display:none!important}
.announcementsDialog{box-sizing:border-box;width:min(620px,calc(100vw - 24px));max-height:85dvh;padding:24px;border:1px solid var(--border,#454b54);border-radius:16px;background:var(--panel,#171b20);color:var(--text,#eef1f5);overflow:hidden}
.announcementsDialog[open]{display:flex;flex-direction:column}.announcementsContent{overflow-y:auto;min-height:0;overscroll-behavior:contain}
.announcementsDialog::backdrop{background:#0008}.announcementsDialog h2{margin:0 0 12px;flex:none}.announcementsDialog article{padding:16px 0;border-top:1px solid var(--border,#454b54)}.announcementsDialog h3{margin:0 0 8px;font-size:17px;overflow-wrap:anywhere}.announcementsDialog article p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;margin:8px 0}.announcementsDialog time,.announcementsStatus{font-size:12px;color:var(--muted,#adb5c2)}.announcementsDialog .announcementLink{margin-top:8px}.announcementsDialog footer{display:flex;flex:none;justify-content:flex-end;margin-top:12px}
@media(max-width:480px){.announcementsDialog{padding:18px}}
`;

// Serialized into the shared Desktop/IDE HTML; remote content is always plain text.
export function setupAnnouncementsUi({ api, language = 'ru', button, canShow = () => true }) {
  const text = (ru, en) => language === 'ru' ? ru : en;
  const translated = value => value[language] || value.en || value.ru;
  const make = (tag, content, parent) => { const el = document.createElement(tag); if (content) el.textContent = content; parent?.appendChild(el); return el; };
  const badge = make('span', '', button); badge.hidden = true;
  const dialog = make('dialog', '', document.body); dialog.className = 'announcementsDialog'; dialog.setAttribute('aria-labelledby', 'announcementsTitle');
  make('h2', text('Объявления SYNVOX', 'SYNVOX announcements'), dialog).id = 'announcementsTitle';
  const status = make('p', '', dialog); status.className = 'announcementsStatus'; status.setAttribute('role', 'status');
  const content = make('div', '', dialog); content.className = 'announcementsContent';
  const close = make('button', text('Закрыть', 'Close'), make('footer', '', dialog)); close.type = 'button'; close.className = 'iconBtn';
  let announcements = [], shown = [], stale = false, pending, closing = false, started = false, returnFocus;
  const active = () => announcements.filter(a => Date.parse(a.expiresAt) > Date.now());
  function updateBadge() {
    const unread = active().filter(a => !a.seen).length;
    badge.hidden = unread === 0; badge.textContent = String(unread);
    button.setAttribute('aria-label', text('Объявления', 'Announcements') + (unread ? ': ' + unread : ''));
  }
  function open(items) {
    if (dialog.open) return;
    shown = items; content.replaceChildren();
    status.textContent = stale ? text('Не удалось обновить объявления. Показаны ранее загруженные.', 'Unable to refresh. Showing previously loaded announcements.')
      : items.length ? '' : text('Сейчас нет действующих объявлений.', 'There are no active announcements.');
    for (const announcement of items) {
      const article = make('article', '', content);
      make('h3', translated(announcement.title), article);
      const date = make('time', new Date(announcement.publishedAt).toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-US'), article); date.dateTime = announcement.publishedAt;
      make('p', translated(announcement.body), article);
      if (announcement.link) {
        const link = make('button', translated(announcement.link.label), article); link.type = 'button'; link.className = 'iconBtn announcementLink';
        link.addEventListener('click', async () => {
          link.disabled = true;
          try { await api('/api/subscription/open-external', { method: 'POST', body: { url: announcement.link.url } }); }
          catch { status.textContent = text('Откройте ссылку в браузере: ', 'Open this link in your browser: ') + announcement.link.url; }
          finally { link.disabled = false; }
        });
      }
    }
    returnFocus = document.activeElement; dialog.showModal(); close.focus();
  }
  function showPending() {
    updateBadge();
    if (document.visibilityState === 'hidden' || !canShow() || dialog.open) return;
    const unread = active().filter(a => !a.seen);
    if (unread.length) open(unread);
  }
  async function refresh() {
    if (!pending) pending = (async () => {
      try { const data = await api('/api/announcements'); announcements = data.announcements; stale = data.stale; }
      catch { stale = true; }
      updateBadge();
    })().finally(() => { pending = null; });
    return pending;
  }
  async function dismiss() {
    if (closing) return;
    closing = true; close.disabled = true;
    try {
      const ids = shown.filter(a => !a.seen).map(a => a.id);
      if (ids.length) await api('/api/announcements/read', { method: 'POST', body: { ids } });
      announcements = announcements.map(a => ids.includes(a.id) ? { ...a, seen: true } : a);
      dialog.close(); updateBadge(); returnFocus?.focus();
    } catch { status.textContent = text('Не удалось сохранить прочтение. Попробуйте закрыть ещё раз.', 'Unable to save dismissal. Try closing again.'); }
    finally { closing = false; close.disabled = false; }
  }
  close.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  button.addEventListener('click', async () => { await refresh(); open(active()); });
  return {
    start() {
      if (started) return; started = true;
      refresh().then(showPending);
      setInterval(() => refresh().then(showPending), 5 * 60_000);
      setInterval(showPending, 15_000);
    },
  };
}
