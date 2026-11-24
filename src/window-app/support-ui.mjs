export const SUPPORT_STYLES = `
.supportDialog [hidden]{display:none!important}
.supportDialog{box-sizing:border-box;width:min(760px,calc(100vw - 24px));max-height:90dvh;padding:24px;border:1px solid var(--border,#454b54);border-radius:16px;background:var(--panel,#171b20);color:var(--text,#eef1f5);overflow:auto}
.supportDialog::backdrop{background:#000a}.supportDialog h2{margin:0 0 16px}.supportDialog label{display:grid;gap:7px;margin:12px 0}.supportDialog textarea,.supportDialog input:not([type=checkbox]){box-sizing:border-box;width:100%;min-width:0;padding:10px;background:var(--bg,#101418);color:inherit;border:1px solid var(--border,#454b54);border-radius:8px}.supportDialog textarea{min-height:100px;resize:vertical}.supportDialog pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.supportDialog img{max-width:100%;max-height:240px;object-fit:contain}.supportDialog .supportConsent{display:flex;align-items:flex-start}.supportDialog .supportConsent input{flex:none;margin-top:4px}.supportActions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.supportDialog button{min-height:36px}.supportNotice{line-height:1.5;color:var(--muted,#adb5c2)}.supportResult{white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}.supportDialog summary{cursor:pointer;padding:8px 0}.supportInline{margin-top:8px;font-size:12px}.supportDialog[open]{display:block}
@media(max-width:480px){.supportDialog{padding:16px}.supportActions button{flex:1 1 130px}}
`;

// Embedded verbatim in Desktop/IDE HTML. All network calls use the protected loopback API.
export function setupSupportUi({ api, getContext = () => ({}), language = 'ru' }) {
  const ru = language === 'ru';
  const text = (a, b) => ru ? a : b;
  const make = (tag, content, parent) => { const e = document.createElement(tag); if (content) e.textContent = content; if (parent) parent.appendChild(e); return e; };
  const button = (content, parent, action) => { const e = make('button', content, parent); e.type = 'button'; e.className = 'iconBtn'; e.addEventListener('click', action); return e; };
  const dialog = make('dialog', '', document.body); dialog.className = 'supportDialog'; dialog.setAttribute('aria-labelledby', 'supportTitle');
  make('h2', text('Сообщить о проблеме', 'Report a problem'), dialog).id = 'supportTitle';
  make('p', text('Диагностика готовится на этом компьютере. Отправка — только после просмотра и отдельного согласия. Не добавляйте пароли, ключи и чужие данные.',
    'Diagnostics are prepared on this computer. Sending requires your review and separate consent. Do not include passwords, keys or other people’s data.'), dialog).className = 'supportNotice';
  const descriptionLabel = make('label', text('Что произошло или что улучшить?', 'What happened, or what should improve?'), dialog);
  const description = make('textarea', '', descriptionLabel); description.maxLength = 16000; description.autocomplete = 'off';
  const contactLabel = make('label', text('Контакт для ответа — необязательно', 'Reply contact — optional'), dialog);
  const contact = make('input', '', contactLabel); contact.maxLength = 200; contact.autocomplete = 'off'; contact.placeholder = 'Telegram / email';
  const fileLabel = make('label', text('Изображение — необязательно (видно ниже до отправки)', 'Image — optional (preview before sending)'), dialog);
  const file = make('input', '', fileLabel); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp';
  const image = make('img', '', dialog); image.alt = text('Изображение для отчёта', 'Report image'); image.hidden = true;
  const removeImage = button(text('Убрать изображение', 'Remove image'), dialog, () => { file.value = ''; screenshot = null; image.removeAttribute('src'); image.hidden = true; removeImage.hidden = true; invalidate(); }); removeImage.hidden = true;
  const preview = make('details', '', dialog); make('summary', text('Что будет отправлено', 'What will be sent'), preview);
  const summary = make('p', '', dialog); summary.className = 'supportNotice';
  const reportBox = make('pre', text('Нажмите «Подготовить отчёт».', 'Select Prepare report.'), preview);
  const policyDetails = make('details', '', dialog); make('summary', text('Отдельное согласие на обработку отчёта', 'Separate support report consent'), policyDetails);
  const policyText = make('p', '', policyDetails); policyText.className = 'supportNotice';
  const consentLabel = make('label', '', dialog); consentLabel.className = 'supportConsent';
  const consent = make('input', '', consentLabel); consent.type = 'checkbox'; consent.checked = false;
  const consentText = make('span', '', consentLabel);
  const status = make('p', '', dialog); status.className = 'supportResult'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const actions = make('div', '', dialog); actions.className = 'supportActions';
  let draft = null, screenshot = null, busy = false, enabled = false, generation = 0, currentError = '', returnFocus;
  const prepare = button(text('Подготовить отчёт', 'Prepare report'), actions, prepareReport);
  const save = button(text('Сохранить файл', 'Save file'), actions, () => {
    if (!draft) return;
    const blob = new Blob([JSON.stringify({ report: draft.report, consentVersion: draft.policy.version }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = make('a'); a.href = url; a.download = 'synvox-report-' + draft.report.id + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = text('Файл сохранён локально. Автоматической отправки не было.', 'Saved locally. Nothing was sent automatically.');
  });
  const send = button(text('Отправить', 'Send'), actions, async () => {
    if (!draft || !consent.checked || !enabled || busy) return;
    setBusy(true); status.textContent = text('Отправляем…', 'Sending…');
    try {
      const receipt = await api('/api/support/send', { method: 'POST', body: { draftId: draft.draftId, consent: true } });
      draft.sent = true; status.textContent = text('Отчёт принят. Номер обращения: ', 'Report received. Reference: ') + receipt.id;
    } catch (error) { status.textContent = error.message; }
    finally { setBusy(false); }
  });
  const close = button(text('Закрыть', 'Close'), actions, () => { if (!busy) dialog.close(); });
  function updateButtons() {
    consentLabel.hidden = !draft || !enabled; policyDetails.hidden = !draft;
    prepare.disabled = busy || Boolean(draft?.sent); save.disabled = busy || !draft;
    send.disabled = busy || !draft || !consent.checked || !enabled || Boolean(draft.sent);
    close.disabled = busy; description.disabled = busy || Boolean(draft?.sent); contact.disabled = description.disabled;
    file.disabled = description.disabled; consent.disabled = busy || Boolean(draft?.sent); removeImage.disabled = description.disabled;
  }
  function setBusy(value) { busy = value; updateButtons(); }
  function invalidate() {
    if (draft) api('/api/support/discard', { method: 'POST', body: { draftId: draft.draftId } }).catch(() => {});
    generation++; draft = null; consent.checked = false; reportBox.textContent = text('Данные изменены. Подготовьте отчёт снова.', 'Details changed. Prepare the report again.'); updateButtons();
  }
  description.addEventListener('input', invalidate); contact.addEventListener('input', invalidate); consent.addEventListener('change', updateButtons);
  file.addEventListener('change', async () => {
    invalidate(); screenshot = null; image.hidden = true; removeImage.hidden = true;
    const selected = file.files[0]; if (!selected) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size > 10_000_000) { file.value = ''; status.textContent = text('Выберите PNG/JPEG/WebP до 10 МБ.', 'Choose PNG/JPEG/WebP up to 10 MB.'); return; }
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(selected);
      try {
        const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
        const canvas = make('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        screenshot = canvas.toDataURL('image/png');
        if (screenshot.length > 2_000_000) throw new Error(text('Изображение слишком большое. Обрежьте его и приложите снова.', 'Image too large. Crop and attach it again.'));
        image.src = screenshot; image.hidden = false; removeImage.hidden = false;
        status.textContent = text('Проверьте изображение: оно может содержать переписку и личные данные.', 'Review the image: it may contain conversations or personal data.');
      } finally { bitmap.close(); }
    } catch (error) { screenshot = null; file.value = ''; status.textContent = error.message; }
    finally { setBusy(false); }
  });
  async function prepareReport() {
    if (busy) return;
    invalidate(); const current = generation;
    setBusy(true); status.textContent = text('Собираем технические сведения локально…', 'Preparing technical details locally…');
    try {
      const result = await api('/api/support/drafts', { method: 'POST', body: {
        description: description.value, contact: contact.value, screenshot, context: { ...getContext(), error: currentError },
      } });
      if (generation !== current) { api('/api/support/discard', { method: 'POST', body: { draftId: result.draftId } }).catch(() => {}); return; }
      draft = result; enabled = result.enabled; consent.checked = false;
      const { screenshot: attached, ...shown } = result.report;
      reportBox.textContent = JSON.stringify({ ...shown, screenshot: attached ? text('Прикреплённое изображение показано выше', 'Attached image shown above') : null }, null, 2);
      summary.textContent = 'SYNVOX ' + shown.diagnostics.app.version + ' · ' + shown.diagnostics.app.surface + ' · '
        + shown.diagnostics.system.platform + ' ' + shown.diagnostics.system.release + ' · ' + (shown.diagnostics.failure.provider || '—');
      const policy = result.policy[ru ? 'ru' : 'en']; policyText.textContent = policy.text; consentText.textContent = policy.checkbox;
      status.textContent = enabled ? text('Проверьте отчёт и подтвердите согласие, чтобы отправить.', 'Review the report and consent before sending.')
        : text('Приём отчётов пока не включён. Можно сохранить файл; данные остаются на вашем компьютере.', 'Report intake is not enabled yet. You can save a file; the data stays on your computer.');
    } catch (error) { status.textContent = error.message; }
    finally { setBusy(false); }
  }
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { invalidate(); returnFocus?.focus(); });
  updateButtons();
  return {
    open(error = '') {
      if (dialog.open) return;
      returnFocus = document.activeElement; currentError = String(error || '');
      draft = null; screenshot = null; description.value = ''; contact.value = ''; file.value = '';
      image.hidden = true; image.removeAttribute('src'); removeImage.hidden = true; consent.checked = false; policyText.textContent = ''; consentText.textContent = '';
      status.textContent = ''; summary.textContent = ''; preview.open = false; policyDetails.open = false; reportBox.textContent = text('Нажмите «Подготовить отчёт».', 'Select Prepare report.');
      updateButtons(); dialog.showModal(); description.focus();
    },
  };
}
