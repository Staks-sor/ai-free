import { toProviderImageFiles } from '../image-input.mjs';
import { captureBrowserDiagnosticScreenshot, summarizeBrowserDiagnosticError } from '../browser-diagnostics.mjs';

// Observe the request made by Qwen's own composer. No synthetic completion POST.
// This function is serialized into the page and must remain self-contained.
export function installQwenNativeCapture(turn) {
  window.__synvoxQwenNativeCapture?.dispose();
  const originalFetch = window.fetch;
  const clearance = () => { try { return document.cookie.match(/(?:^|;\s*)x5sec=([^;]+)/)?.[1] || ''; } catch { return ''; } };
  const state = { turnId: turn.turnId, chatId: turn.chatId, bootstrap: null, creatingChat: false,
    started: false, result: null, error: null, controller: new AbortController(),
    challengeSeen: false, replayed: false, dispatchedBody: null, initialClearance: clearance() };
  const fail = (message, code = 'QWEN_NATIVE_TURN_MISMATCH') => {
    state.error ||= { message, code, delivery: state.started ? 'unknown' : 'not_sent' };
    return Object.assign(new Error(message), state.error);
  };
  const beginCreation = rawBody => {
    if (state.creatingChat || state.started) throw fail('Qwen: повторное создание штатного чата остановлено.');
    const body = JSON.parse(rawBody);
    if (!Array.isArray(body.models) || body.models.length !== 1 || body.models[0] !== turn.model) {
      throw fail('Qwen: модель нового штатного чата не совпадает с задачей.');
    }
    state.creatingChat = true;
  };
  const attestCreation = async (ok, json) => {
    if (state.controller.signal.aborted) throw fail('Qwen: отправка остановлена.', 'ABORT_ERR');
    const chatId = json?.data?.id;
    if (!ok || json?.success !== true || typeof chatId !== 'string' || !chatId.trim()) {
      throw fail('Qwen: создание штатного чата не подтвердилось.');
    }
    state.chatId = chatId;
    state.bootstrap = { previousChatId: turn.chatId, chatId };
    const acknowledged = await window.__qwenNativeBootstrap?.(turn.workerId, state.bootstrap);
    if (state.controller.signal.aborted || acknowledged === false) throw fail('Qwen: отправка остановлена.', 'ABORT_ERR');
  };
  const isRootCreation = (url, method) => turn.allowNativeRootChat && turn.parentId == null
    && url.origin === window.location.origin && url.pathname === '/api/v2/chats/new' && method === 'POST';
  const timer = setTimeout(() => {
    fail('Qwen: время ожидания штатной отправки истекло.', 'QWEN_BROWSER_TRANSPORT_FAILURE');
    state.controller.abort();
  }, turn.timeoutMs);
  const observe = async response => {
    let reader;
    try {
      const copy = response.clone();
      reader = copy.body?.getReader();
      const decoder = new TextDecoder();
      let text = '';
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          text += chunk;
          if (chunk) await window.__qwenRawStreamChunk(turn.workerId, chunk);
          if (/(^|\n)data:\s*\[DONE\](\r?\n|$)/.test(text)) {
            void reader.cancel?.().catch(() => {});
            break;
          }
        }
        const tail = decoder.decode();
        if (tail) { text += tail; await window.__qwenRawStreamChunk(turn.workerId, tail); }
      } else {
        text = await copy.text();
        if (text) await window.__qwenRawStreamChunk(turn.workerId, text);
      }
      state.result = { ok: response.ok, status: response.status, text,
        ...(state.imageFileIds ? { qwenImageFileIds: state.imageFileIds } : {}),
        contentType: response.headers.get('content-type') || '', retryAfter: response.headers.get('retry-after'),
        ...(state.bootstrap ? { nativeBootstrap: state.bootstrap } : {}) };
    } catch (error) {
      fail(String(error?.message || error), 'QWEN_BROWSER_TRANSPORT_FAILURE');
    } finally { clearTimeout(timer); reader?.releaseLock(); }
  };
  const wrapper = async function (input, init) {
    const url = new URL(input?.url || String(input), window.location.href);
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    // Qwen redirects a proven empty API chat to its home screen. Observe the
    // one chat its own composer creates, before allowing that root model POST.
    if (isRootCreation(url, method)) {
      beginCreation(init?.body ?? await input.clone().text());
      try {
        const response = await originalFetch.call(this, input, { ...init, signal: state.controller.signal });
        await attestCreation(response.ok, await response.clone().json());
        return response;
      } catch (error) {
        throw fail(String(error?.message || error), error.code || 'QWEN_BROWSER_TRANSPORT_FAILURE');
      }
    }
    if (url.origin !== window.location.origin || url.pathname !== '/api/v2/chat/completions'
      || method !== 'POST') {
      return originalFetch.call(this, input, init);
    }
    let rawBody;
    try {
      await state.bootstrapPromise;
      if (state.error) throw fail(state.error.message, state.error.code);
      if (state.controller.signal.aborted) throw fail('Qwen: отправка остановлена.', 'ABORT_ERR');
      rawBody = init?.body ?? await input.clone().text();
      const body = JSON.parse(rawBody);
      const users = body.messages?.filter(message => message.role === 'user') || [];
      const user = users.at(-1);
      const chats = [body.chat_id, body.chatId].filter(id => id !== undefined);
      const parents = [body.parent_id, body.parentId, user?.parent_id, user?.parentId].filter(id => id !== undefined);
      if (url.searchParams.get('chat_id') !== state.chatId
        || !chats.length || chats.some(id => id !== state.chatId)
        || !parents.length || parents.some(id => String(id || '') !== String(turn.parentId || ''))
        || body.model !== turn.model || user?.content !== turn.prompt) {
        throw fail('Qwen: чат, модель или ветка штатной отправки не совпадают с сохранённой задачей.');
      }
      // Qwen also puts automatically detected links in files[], without upload IDs.
      const files = Array.isArray(user?.files) ? user.files.filter(file => file?.file_class !== 'url') : [];
      const ids = files.map(file => file?.file?.id || file?.id);
      if (ids.length !== (turn.imageCount || 0) || ids.some(id => typeof id !== 'string' || !id)
        || new Set(ids).size !== ids.length) {
        throw fail('Qwen: изображения не прикрепились к штатному запросу.', 'QWEN_NATIVE_IMAGE_MISMATCH');
      }
      state.imageFileIds = ids;
    } catch (error) { clearTimeout(timer); throw fail(String(error?.message || error), error.code || 'QWEN_BROWSER_TRANSPORT_FAILURE'); }
    // Claim dispatch after every await; concurrent calls must not both pass.
    const replay = state.started;
    if (replay && (!state.challengeSeen || state.replayed || rawBody !== state.dispatchedBody
      || !clearance() || clearance() === state.initialClearance)) {
      throw new Error('Qwen: повторная отправка этого хода остановлена.');
    }
    if (replay) state.replayed = true;
    else state.dispatchedBody = rawBody;
    state.started = true;
    try {
      const upstreamSignal = init?.signal || input?.signal;
      if (upstreamSignal?.aborted) state.controller.abort(upstreamSignal.reason);
      const abort = () => state.controller.abort(upstreamSignal.reason);
      upstreamSignal?.addEventListener('abort', abort, { once: true });
      const disposePrevious = state.disposeSignal;
      state.disposeSignal = () => { disposePrevious?.(); upstreamSignal?.removeEventListener('abort', abort); };
      const response = await originalFetch.call(this, input, { ...init, signal: state.controller.signal });
      // The intercepted fetch and Baxia's replay can resolve with the same answer.
      if (replay || !state.replayed) void observe(response);
      return response;
    } catch (error) { clearTimeout(timer); throw fail(String(error?.message || error), error.code || 'QWEN_BROWSER_TRANSPORT_FAILURE'); }
  };
  // The current site creates chats through Axios/XHR, then streams via fetch.
  const xhrPrototype = window.XMLHttpRequest?.prototype;
  const originalOpen = xhrPrototype?.open, originalSend = xhrPrototype?.send;
  const xhrRequests = new WeakMap();
  const open = function (method, input, ...args) {
    xhrRequests.set(this, { url: new URL(input, window.location.href), method: String(method).toUpperCase() });
    return originalOpen.call(this, method, input, ...args);
  };
  const send = function (body) {
    const request = xhrRequests.get(this);
    if (!request || !isRootCreation(request.url, request.method)) return originalSend.call(this, body);
    beginCreation(body);
    const xhr = this;
    state.bootstrapPromise = new Promise((resolve, reject) => {
      const abort = () => xhr.abort();
      const cleanup = () => {
        state.controller.signal.removeEventListener('abort', abort);
        for (const event of ['load', 'error', 'abort', 'timeout']) xhr.removeEventListener(event, settle);
      };
      const settle = async event => {
        cleanup();
        try {
          if (event.type !== 'load') throw fail('Qwen: создание штатного чата прервано.',
            event.type === 'abort' ? 'ABORT_ERR' : 'QWEN_BROWSER_TRANSPORT_FAILURE');
          const json = xhr.responseType === 'json' ? xhr.response : JSON.parse(xhr.responseText);
          await attestCreation(xhr.status >= 200 && xhr.status < 300, json);
          resolve();
        } catch (error) { reject(fail(String(error?.message || error), error.code || 'QWEN_BROWSER_TRANSPORT_FAILURE')); }
      };
      for (const event of ['load', 'error', 'abort', 'timeout']) xhr.addEventListener(event, settle);
      state.controller.signal.addEventListener('abort', abort, { once: true });
      try {
        if (state.controller.signal.aborted) throw fail('Qwen: отправка остановлена.', 'ABORT_ERR');
        originalSend.call(xhr, body);
      } catch (error) { cleanup(); reject(fail(String(error?.message || error), error.code || 'QWEN_BROWSER_TRANSPORT_FAILURE')); }
    });
    void state.bootstrapPromise.catch(() => {});
  };
  if (xhrPrototype) { xhrPrototype.open = open; xhrPrototype.send = send; }
  state.dispose = () => {
    clearTimeout(timer);
    state.disposeSignal?.();
    if (window.fetch === wrapper) window.fetch = originalFetch;
    if (xhrPrototype?.open === open) xhrPrototype.open = originalOpen;
    if (xhrPrototype?.send === send) xhrPrototype.send = originalSend;
  };
  window.__synvoxQwenNativeCapture = state;
  window.fetch = wrapper;
}

function nativeUiError(message, code = 'QWEN_NATIVE_UI_UNAVAILABLE') {
  return Object.assign(new Error(message), { code, delivery: 'not_sent' });
}

const modelKey = text => String(text).toLowerCase().replace(/[\s_-]/g, '');
const thinkingNames = /^(?:Thinking|Мышление)$/i;
const fastNames = /^(?:Fast|Быстрый)$/i;
const webSearchNames = /^(?:Web search|Поиск в сети)$/i;

export async function attachQwenImages(page, images = [], { signal } = {}) {
  const files = toProviderImageFiles(images);
  if (!files.length) return;
  signal?.throwIfAborted();
  try {
    const selectMode = page.getByRole('button', { name: /^(?:Select Mode|Выбрать режим)$/i });
    const fileChooser = page.waitForEvent('filechooser', { timeout: 15_000 });
    let fileChooserError = null;
    fileChooser.catch(error => { fileChooserError = error; });
    await selectMode.click({ timeout: 3_000 });
    signal?.throwIfAborted();
    const upload = page.getByRole('menuitem', { name: /^(?:Upload attachment file, image, video, audio|Загрузить вложение(?:\s|$))/i });
    try {
      await upload.waitFor({ state: 'visible', timeout: 3_000 });
    } catch (error) {
      throw nativeUiError('Qwen: пункт загрузки вложения не найден в меню режима. Запрос не отправлен.');
    }
    if (fileChooserError) throw fileChooserError;
    await upload.click({ timeout: 3_000 });
    const chooser = await fileChooser;
    signal?.throwIfAborted();
    await chooser.setFiles(files);
    signal?.throwIfAborted();
    const status = await page.waitForFunction(count => {
      const items = [...document.querySelectorAll('.vision-item-container')];
      if (items.some(item => item.classList.contains('vision-item-container-error'))) return { failed: true };
      return items.length === count && items.every(item => {
        const image = item.querySelector('img.vision-item-image');
        return image?.complete && image.naturalWidth > 0 && /^https:\/\//.test(image.getAttribute('src') || '');
      }) ? { ready: true } : false;
    }, files.length, { timeout: 45_000 });
    signal?.throwIfAborted();
    if (!(await status.jsonValue()).ready) throw nativeUiError('Qwen: загрузка изображения не удалась. Запрос не отправлен.');
  } catch (error) {
    if (process.env.SYNVOX_DEBUG_IMAGE_INPUT) await logQwenImageInputDiagnostics(page);
    signal?.throwIfAborted();
    error.delivery = 'not_sent';
    error.code ||= 'QWEN_NATIVE_IMAGE_UPLOAD_FAILED';
    throw error;
  }
}

async function logQwenImageInputDiagnostics(page) {
  try {
    const diagnostics = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.vision-item-container')];
      const srcSchemes = [...new Set(items.map(item => item.querySelector('img.vision-item-image')?.getAttribute('src') || '')
        .filter(Boolean).map(src => src.match(/^[a-z][a-z0-9+.-]*:/i)?.[0] || 'relative'))];
      return {
        previewCount: items.length,
        errorCount: items.filter(item => item.classList.contains('vision-item-container-error')).length,
        srcSchemes,
      };
    });
    console.log(`[qwen] image input ${JSON.stringify(diagnostics)}`);
  } catch (error) {
    console.log(`[qwen] image input diagnostics failed ${summarizeBrowserDiagnosticError(error)}`);
  }
  try {
    const screenshot = await captureBrowserDiagnosticScreenshot(page, 'qwen-image-input');
    console.log(`[qwen] image input screenshot ${screenshot}`);
  } catch (error) {
    console.log(`[qwen] image input screenshot failed ${summarizeBrowserDiagnosticError(error)}`);
  }
}

export async function prepareQwenNativeComposer(page, { prompt, model, thinking, search, images = [], signal }) {
  const act = async action => {
    signal?.throwIfAborted();
    const result = await action();
    signal?.throwIfAborted();
    return result;
  };
  signal?.throwIfAborted();
  const input = page.locator('textarea.message-input-textarea');
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  const selectModel = page.getByRole('button', { name: /^(?:Select Model|Выбрать модель)$/i });
  const readModel = async () => {
    try { return await act(() => selectModel.innerText({ timeout: 3000 })); }
    catch (error) {
      signal?.throwIfAborted();
      if (error.name !== 'TimeoutError') throw error;
      throw nativeUiError('Qwen: выбор модели не появился. Запрос не отправлен; повторите после загрузки страницы.');
    }
  };
  if (modelKey(await readModel()) !== modelKey(model)) {
    await act(() => selectModel.click({ timeout: 3000 }));
    const choices = await page.getByRole('option').all();
    let matched = null;
    for (const choice of choices) {
      const label = (await choice.innerText()).split('\n')[0];
      if (modelKey(label) === modelKey(model)) matched = choice;
    }
    if (!matched || !await matched.isEnabled()) throw nativeUiError('Qwen: выбранная модель недоступна в веб-интерфейсе. Выберите доступную модель.', 'QWEN_NATIVE_MODEL_UNAVAILABLE');
    await act(() => matched.click({ timeout: 3000 }));
    if (modelKey(await readModel()) !== modelKey(model)) {
      await act(() => page.waitForFunction(expected => {
        const text = [...document.querySelectorAll('button[aria-label], [role="button"][aria-label]')].find(button =>
          /^(?:Select Model|Выбрать модель)$/i.test(button.getAttribute('aria-label')))?.innerText || '';
        return text.toLowerCase().replace(/[\s_-]/g, '') === expected;
      }, modelKey(model), { timeout: 3000 }));
    }
  }
  // These controls are observed in the current Qwen UI, not inferred API flags.
  const thinkingLabel = page.locator('.qwen-chat-v2-dropdown-menu-select-label');
  const wanted = thinking ? 'Thinking' : 'Fast';
  const wantedNames = thinking ? thinkingNames : fastNames;
  if (!wantedNames.test((await thinkingLabel.innerText()).trim())) {
    // Camoufox uses ru-RU: the same popup's accessible name is "В раздумье".
    const menu = page.locator('.qwen-chat-v2-dropdown-menu-popup');
    const trigger = page.locator('.qwen-chat-v2-dropdown-menu-select-button');
    for (let attempt = 0; attempt < 2 && !await menu.isVisible(); attempt++) {
      await act(() => trigger.click({ timeout: 3000 }));
      try { await act(() => menu.waitFor({ state: 'visible', timeout: 1500 })); }
      catch (error) {
        signal?.throwIfAborted();
        if (error.name !== 'TimeoutError') throw error;
      }
    }
    signal?.throwIfAborted();
    if (!await menu.isVisible()) throw nativeUiError('Qwen: меню режима не открылось. Запрос не отправлен; сохранённую задачу можно продолжить.');
    try { await act(() => menu.getByRole('menuitem', { name: wantedNames }).click({ timeout: 3000 })); }
    catch (error) {
      signal?.throwIfAborted();
      if (error.name !== 'TimeoutError') throw error;
      throw nativeUiError(`Qwen: режим ${wanted} недоступен в открытом меню. Запрос не отправлен.`);
    }
    if (!wantedNames.test((await thinkingLabel.innerText()).trim())) throw nativeUiError(`Qwen: режим ${wanted} не подтвердился. Запрос не отправлен.`);
  }
  const mode = page.locator('.mode-select-current-mode');
  const activeMode = await mode.count() ? (await mode.innerText()).trim() : '';
  const activeSearch = webSearchNames.test(activeMode);
  if (activeMode && (!search || !activeSearch)) await act(() => page.locator('.mode-select-current-mode-close').click({ timeout: 3000 }));
  if (search && !activeSearch) {
    await act(() => page.getByRole('button', { name: /^(?:Select Mode|Выбрать режим)$/i }).click({ timeout: 3000 }));
    await act(() => page.getByRole('menuitem', { name: webSearchNames }).click({ timeout: 3000 }));
  }
  signal?.throwIfAborted();
  await attachQwenImages(page, images, { signal });
  await act(() => input.fill(prompt));
  if (await input.inputValue() !== prompt) throw nativeUiError('Qwen: поле ввода не сохранило полный запрос. Отправка остановлена.');
  const send = page.getByRole('button', { name: /^(?:Send|Отправить)$/i });
  if (!await send.isEnabled()) throw nativeUiError('Qwen: штатная кнопка отправки недоступна. Проверьте сессию в окне Qwen.');
  return send;
}

export async function submitQwenNativeTurn(page, turn, { beforeSend, signal, timeoutMs = 600_000 } = {}) {
  let installed = false, clicked = false;
  const abort = () => { void page.evaluate(() => {
    const state = window.__synvoxQwenNativeCapture;
    if (!state) return;
    state.error ||= { message: 'Qwen: отправка остановлена.', code: 'ABORT_ERR', delivery: state.started ? 'unknown' : 'not_sent' };
    state.controller.abort();
  }).catch(() => {}); };
  try {
    const send = await prepareQwenNativeComposer(page, { ...turn, signal });
    signal?.throwIfAborted();
    const { images = [], ...captureTurn } = turn;
    await page.evaluate(installQwenNativeCapture, { ...captureTurn, imageCount: images.length, timeoutMs });
    installed = true;
    signal?.addEventListener('abort', abort, { once: true });
    await beforeSend?.();
    signal?.throwIfAborted();
    clicked = true;
    await send.click({ timeout: 15_000 });
    const dispatched = await page.waitForFunction(() => {
      const state = window.__synvoxQwenNativeCapture;
      return Boolean(state?.creatingChat || state?.started || state?.error);
    }, null, { timeout: 1500 }).then(() => true, error => {
      if (error.name !== 'TimeoutError' && !/Timeout .* exceeded/.test(error.message)) throw error;
      return false;
    });
    signal?.throwIfAborted();
    if (!dispatched) {
      const untouched = await page.evaluate(turnId => {
        const state = window.__synvoxQwenNativeCapture;
        return state?.turnId === turnId && !state.creatingChat && state.started === false && !state.error;
      }, turn.turnId);
      if (!untouched) throw Object.assign(new Error('Qwen: результат нажатия Send неизвестен.'),
        { code: 'QWEN_BROWSER_TRANSPORT_FAILURE', delivery: 'unknown' });
      // The observer remains installed and allows only one actual POST.
      await send.click({ timeout: 15_000 });
      await page.waitForFunction(() => {
        const state = window.__synvoxQwenNativeCapture;
        return Boolean(state?.creatingChat || state?.started || state?.error);
      }, null, { timeout: 15_000 });
    }
    await page.waitForFunction(() => {
      const state = window.__synvoxQwenNativeCapture;
      return Boolean(state?.result || state?.error);
    }, null, { timeout: timeoutMs + 1000 });
    signal?.throwIfAborted();
    const state = await page.evaluate(() => {
      const { result, error } = window.__synvoxQwenNativeCapture;
      return { result, error };
    });
    if (state.error) throw Object.assign(new Error(state.error.message), state.error);
    return state.result;
  } catch (error) {
    if (installed) {
      const imageFileIds = await page.evaluate(() => window.__synvoxQwenNativeCapture?.imageFileIds).catch(() => null);
      if (imageFileIds) {
        error.qwenImageFileIds = imageFileIds;
        if (signal?.aborted && signal.reason instanceof Error) signal.reason.qwenImageFileIds = imageFileIds;
      }
      const bootstrap = await page.evaluate(() => window.__synvoxQwenNativeCapture?.bootstrap).catch(() => null);
      if (bootstrap) {
        error.qwenNativeBootstrap = bootstrap;
        if (signal?.aborted && signal.reason instanceof Error) signal.reason.qwenNativeBootstrap = bootstrap;
      }
    }
    if (signal?.aborted) signal.throwIfAborted();
    error.delivery ||= clicked ? 'unknown' : 'not_sent';
    error.code ||= clicked ? 'QWEN_BROWSER_TRANSPORT_FAILURE' : 'QWEN_NATIVE_UI_UNAVAILABLE';
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (installed) await page.evaluate(() => {
      const state = window.__synvoxQwenNativeCapture;
      if (!state.result || state.replayed) state.controller.abort();
      state.dispose();
      delete window.__synvoxQwenNativeCapture;
    }).catch(() => {});
  }
}
