import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderWindowHtml } from '../src/window-app/ui-html.mjs';

function folderBrowser() {
  const elements = new Map();
  const element = () => ({ value: '', textContent: '', checked: false, children: [],
    classList: { add() {}, remove() {}, contains() { return true; } },
    addEventListener(name, listener) { this[name] = listener; },
    appendChild(child) { this.children.push(child); }, focus() {} });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const input = element(); input.value = '/projects/ai-free';
  const requests = [];
  const context = vm.createContext({
    document: { getElementById: get, createElement: element },
    newWorkspaceInput: input, browseDefaultPath: '/projects/ai-free', URLSearchParams,
    t: key => key,
    api: async (url, options) => {
      requests.push({ url, options });
      if (url === '/api/browse/mkdir') return { path: options.body.parent + '/' + options.body.name };
      const target = new URLSearchParams(url.split('?')[1]).get('path');
      return { path: target, parent: '/projects', home: '/projects', entries: [] };
    },
  });
  const html = renderWindowHtml({ language: 'ru' });
  vm.runInContext(html.slice(html.indexOf('    const browseBtn ='), html.indexOf('    document.getElementById("newForm").addEventListener("submit"')), context);
  return { input, get, requests, navigate: target => vm.runInContext(`navigateBrowse(${JSON.stringify(target)})`, context) };
}

test('opening another folder selects it without an extra confirmation', async () => {
  const ui = folderBrowser();
  await ui.navigate('/projects/other');
  assert.equal(ui.input.value, '/projects/other');
});

test('creating a folder selects the returned path for the chat', async () => {
  const ui = folderBrowser();
  await ui.navigate('/projects/other');
  ui.get('createFolderInput').value = 'new-app';
  await ui.get('createFolderConfirm').click();
  assert.equal(ui.requests.find(r => r.url === '/api/browse/mkdir').options.body.parent, '/projects/other');
  assert.equal(ui.input.value, '/projects/other/new-app');
});
