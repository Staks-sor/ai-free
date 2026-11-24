import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { prepareQwenNativeComposer } from '../src/providers/qwen/native-composer.mjs';

function makePage({ label = 'Fast', popupInitiallyVisible = false, opensOnClick = 1, abortOnClick = false,
  menuName = 'Thinking', fastLabel = 'Fast', thinkingLabel = 'Thinking', sendLabel = 'Send',
  searchLabel = 'Web search', selectModeLabel = 'Select Mode', modelButtonLabel = 'Select Model',
  selectedModel = 'qwen-model-a', availableModels = ['qwen-model-a'], missingModelButton = false, activeMode = '' } = {}) {
  const state = { triggerClicks: 0, itemClicks: [], fills: [], menuWaits: [], inputWaits: [], modelReads: [], sendClicks: 0 };
  let popupVisible = popupInitiallyVisible;
  let promptValue = '';
  const input = {
    async waitFor(options) { state.inputWaits.push(options); },
    async fill(value) { promptValue = value; state.fills.push(value); },
    async inputValue() { return promptValue; },
  };
  const trigger = {
    async innerText() { return label; },
    async click() {
      state.triggerClicks += 1;
      if (abortOnClick) controller.abort(new Error('stopped'));
      if (state.triggerClicks >= opensOnClick) popupVisible = true;
    },
  };
  const controller = new AbortController();
  const send = { async isEnabled() { return true; }, async click() { state.sendClicks += 1; } };
  const menu = {
    async isVisible() { return popupVisible; },
    getByRole(role, options) {
      assert.equal(role, 'menuitem');
      return item(role, options);
    },
    async waitFor(options) {
      state.menuWaits.push(options);
      if (!popupVisible) throw Object.assign(new Error('popup did not open'), { name: 'TimeoutError' });
    },
  };
  function item(_role, options) {
    return {
      async click() {
        const selected = [fastLabel, thinkingLabel].find(text => options.name instanceof RegExp ? options.name.test(text) : options.name === text);
        if (!selected) throw Object.assign(new Error('mode item not found'), { name: 'TimeoutError' });
        state.itemClicks.push(selected);
        if (!popupVisible) throw new Error('menu item is not visible');
        label = ` ${selected}\n`;
      },
    };
  }
  const page = {
    locator(selector) {
      if (selector === 'textarea.message-input-textarea') return input;
      if (selector === '.qwen-chat-v2-dropdown-menu-select-label'
        || selector === '.qwen-chat-v2-dropdown-menu-select-button') return trigger;
      if (selector === '.mode-select-current-mode') return { async count() { return activeMode ? 1 : 0; }, async innerText() { return activeMode; } };
      if (selector === '.mode-select-current-mode-close') return { async click() { state.itemClicks.push('remove search'); activeMode = ''; } };
      if (selector === '.qwen-chat-v2-dropdown-menu-popup') return menu;
      throw new Error(`Unexpected locator: ${selector}`);
    },
    getByRole(role, options) {
      if (role === 'button' && (options.name instanceof RegExp ? options.name.test(modelButtonLabel) : options.name === modelButtonLabel)) return {
        async innerText(options) {
          state.modelReads.push(options);
          if (missingModelButton) throw Object.assign(new Error('model button missing'), { name: 'TimeoutError' });
          return selectedModel;
        },
        async click() { state.itemClicks.push('open models'); },
      };
      if (role === 'option') return { async all() { return availableModels.map(model => ({
        async innerText() { return `${model}\nModel description`; },
        async isEnabled() { return true; },
        async click() { state.itemClicks.push(model); selectedModel = model; },
      })); } };
      if (role === 'button' && (options.name instanceof RegExp ? options.name.test(sendLabel) : options.name === sendLabel)) return send;
      if (role === 'button' && (options.name instanceof RegExp ? options.name.test(selectModeLabel) : options.name === selectModeLabel)) return {
        async click() { state.itemClicks.push('open search'); },
      };
      if (role === 'menu') return options.name === menuName ? menu : {
        async isVisible() { return false; },
        async waitFor() { throw Object.assign(new Error('localized menu name differs'), { name: 'TimeoutError' }); },
      };
      if (role === 'menuitem') {
        if (!(options.name instanceof RegExp ? options.name.test(searchLabel) : options.name === searchLabel)) throw new Error('search menu item not found');
        return { async click() { state.itemClicks.push(searchLabel); activeMode = searchLabel; } };
      }
      throw new Error(`Unexpected role: ${role}/${options?.name}`);
    },
  };
  return { page, state, signal: controller.signal, popupVisible: () => popupVisible };
}

const base = { prompt: 'keep this prompt', model: 'qwen-model-a', thinking: false, search: false };

test('model confirmation supports the current Qwen div with role=button after async selection', async () => {
  const { page, state } = makePage({ selectedModel: 'qwen-other', availableModels: [base.model] });
  const getByRole = page.getByRole.bind(page);
  page.getByRole = (role, options) => {
    const target = getByRole(role, options);
    if (role === 'button' && (options.name instanceof RegExp ? options.name.test('Select Model') : options.name === 'Select Model')) {
      return { ...target, async innerText() { return 'qwen-other'; } };
    }
    return target;
  };
  let confirmations = 0;
  page.waitForFunction = async (check, expected) => {
    confirmations++;
    const div = { innerText: base.model, getAttribute: () => 'Select Model' };
    const context = vm.createContext({ document: { querySelectorAll: selector => selector.includes('[role="button"]') ? [div] : [] } });
    assert.equal(vm.runInContext(`(${check.toString()})(${JSON.stringify(expected)})`, context), true);
  };
  await prepareQwenNativeComposer(page, base);
  assert.equal(confirmations, 1);
  assert.deepEqual(state.fills, [base.prompt]);
});

test('Russian model selector prepares the draft without waiting for an English button', async () => {
  const { page, state } = makePage({ modelButtonLabel: 'Выбрать модель', label: 'Быстрый', sendLabel: 'Отправить' });
  await prepareQwenNativeComposer(page, base);
  assert.deepEqual(state.fills, [base.prompt]);
  assert.equal(state.sendClicks, 0);
});

test('localized selector switches to the requested model before preparing the draft', async () => {
  const { page, state } = makePage({ modelButtonLabel: 'Выбрать модель', selectedModel: 'qwen-other', availableModels: ['qwen-other', base.model] });
  await prepareQwenNativeComposer(page, base);
  assert.deepEqual(state.itemClicks, ['open models', base.model]);
  assert.deepEqual(state.fills, [base.prompt]);
});

test('missing model button fails with bounded not-sent error without filling or sending', async () => {
  const { page, state } = makePage({ missingModelButton: true });
  await assert.rejects(prepareQwenNativeComposer(page, base), error => error.delivery === 'not_sent' && error.code === 'QWEN_NATIVE_UI_UNAVAILABLE');
  assert.ok(state.modelReads[0].timeout <= 3000);
  assert.deepEqual(state.fills, []);
  assert.equal(state.sendClicks, 0);
});

test('unavailable requested model never sends through a different model', async () => {
  const { page, state } = makePage({ modelButtonLabel: 'Выбрать модель', selectedModel: 'qwen-other', availableModels: ['qwen-other'] });
  await assert.rejects(prepareQwenNativeComposer(page, base), error => error.delivery === 'not_sent' && error.code === 'QWEN_NATIVE_MODEL_UNAVAILABLE');
  assert.deepEqual(state.fills, []);
  assert.equal(state.sendClicks, 0);
});

test('an already selected trimmed Fast mode is left alone', async () => {
  const { page, state } = makePage({ label: ' Fast\n' });
  await prepareQwenNativeComposer(page, base);
  assert.equal(state.triggerClicks, 0);
  assert.deepEqual(state.itemClicks, []);
  assert.deepEqual(state.fills, [base.prompt]);
});

test('selects Fast from an already open Thinking menu without toggling it closed', async () => {
  const { page, state } = makePage({ label: 'Thinking', popupInitiallyVisible: true });
  await prepareQwenNativeComposer(page, base);
  assert.equal(state.triggerClicks, 0);
  assert.deepEqual(state.itemClicks, ['Fast']);
  assert.deepEqual(state.fills, [base.prompt]);
});

test('retries the mode trigger once when its first click does not open the menu', async () => {
  const { page, state, popupVisible } = makePage({ label: 'Thinking', opensOnClick: 2 });
  await prepareQwenNativeComposer(page, base);
  assert.equal(state.triggerClicks, 2);
  assert.equal(popupVisible(), true);
  assert.deepEqual(state.itemClicks, ['Fast']);
  assert.deepEqual(state.fills, [base.prompt]);
});

test('a menu that never opens fails as not sent without filling the prompt', async () => {
  const { page, state } = makePage({ label: 'Thinking', opensOnClick: Infinity });
  await assert.rejects(prepareQwenNativeComposer(page, base), error => {
    assert.equal(error.code, 'QWEN_NATIVE_UI_UNAVAILABLE');
    assert.equal(error.delivery, 'not_sent');
    return true;
  });
  assert.ok(state.triggerClicks <= 2);
  assert.ok(state.menuWaits.every(wait => wait.timeout <= 1500));
  assert.deepEqual(state.fills, []);
  assert.equal(state.sendClicks, 0);
});

test('Stop during the mode trigger prevents menu selection and prompt fill', async () => {
  const { page, state, signal } = makePage({ label: 'Thinking', abortOnClick: true });
  await assert.rejects(prepareQwenNativeComposer(page, { ...base, signal }), /stopped/);
  assert.deepEqual(state.itemClicks, []);
  assert.deepEqual(state.fills, []);
  assert.equal(state.sendClicks, 0);
});

test('Russian Camoufox selects Быстрый from the visible В раздумье menu', async () => {
  const { page, state } = makePage({ label: 'Авто', menuName: 'В раздумье', fastLabel: 'Быстрый', thinkingLabel: 'Мышление' });
  await prepareQwenNativeComposer(page, base);
  assert.equal(state.triggerClicks, 1);
  assert.deepEqual(state.itemClicks, ['Быстрый']);
  assert.deepEqual(state.fills, [base.prompt]);
});

test('Russian Camoufox keeps an already selected Быстрый mode', async () => {
  const { page, state } = makePage({ label: ' Быстрый\n', menuName: 'В раздумье', fastLabel: 'Быстрый', thinkingLabel: 'Мышление' });
  await prepareQwenNativeComposer(page, base);
  assert.equal(state.triggerClicks, 0);
  assert.deepEqual(state.itemClicks, []);
});

test('Russian Camoufox selects and confirms Мышление', async () => {
  const { page, state } = makePage({ label: 'Быстрый', menuName: 'В раздумье', fastLabel: 'Быстрый', thinkingLabel: 'Мышление' });
  await prepareQwenNativeComposer(page, { ...base, thinking: true });
  assert.equal(state.triggerClicks, 1);
  assert.deepEqual(state.itemClicks, ['Мышление']);
});

test('Russian composer finds Отправить after filling the whole draft', async () => {
  const { page, state } = makePage({ label: 'Быстрый', sendLabel: 'Отправить' });
  await prepareQwenNativeComposer(page, base);
  assert.deepEqual(state.fills, [base.prompt]);
  assert.equal(state.sendClicks, 0);
});

test('Russian composer enables Поиск в сети through Выбрать режим', async () => {
  const { page, state } = makePage({ sendLabel: 'Отправить', selectModeLabel: 'Выбрать режим', searchLabel: 'Поиск в сети' });
  await prepareQwenNativeComposer(page, { ...base, search: true });
  assert.deepEqual(state.itemClicks, ['open search', 'Поиск в сети']);
});

test('an already selected Russian web search is kept rather than toggled', async () => {
  const { page, state } = makePage({ activeMode: ' Поиск в сети\n', sendLabel: 'Отправить' });
  await prepareQwenNativeComposer(page, { ...base, search: true });
  assert.deepEqual(state.itemClicks, []);
});
