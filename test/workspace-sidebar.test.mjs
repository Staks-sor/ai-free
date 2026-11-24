import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as ui from '../src/window-app/workspace-ui-script.mjs';
import {renderWindowHtml} from '../src/window-app/ui-html.mjs';

test('sidebar and secondary menu persist independently and remain reversible', () => {
  assert.equal(typeof ui.setupWorkspaceSidebar, 'function');
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, { open:false, attrs:{}, events:{}, setAttribute(k,v){this.attrs[k]=v;}, addEventListener(k,f){this.events[k]=f;}, focus(){this.focused=true;} }); return nodes.get(id); };
  const classes = new Set();
  const storage = new Map([['synvox.sidebarCollapsed','1']]);
  const context = vm.createContext({document:{getElementById:node,body:{classList:{contains:k=>classes.has(k),toggle(k,v){if(v??!classes.has(k))classes.add(k);else classes.delete(k);}}}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},matchMedia:()=>({matches:false}),String});
  vm.runInContext(`(${ui.setupWorkspaceSidebar.toString()})()`,context);
  assert.ok(classes.has('workspaceSidebarCollapsed'));
  node('workspaceMobileMenu').events.click();
  assert.ok(!classes.has('workspaceSidebarCollapsed'));
  assert.equal(storage.get('synvox.sidebarCollapsed'),'0');
  node('workspaceSidebarCollapse').events.click();
  assert.ok(classes.has('workspaceSidebarCollapsed'));
  assert.equal(node('workspaceMobileMenu').attrs['aria-expanded'],'false');
  node('workspaceFooterMenu').open=true;node('workspaceFooterMenu').events.toggle();
  assert.equal(storage.get('synvox.sidebarMoreOpen'),'1');
});

test('secondary actions are inside a closed native disclosure, collapse is keyboard accessible',()=>{
  const html=renderWindowHtml({language:'ru'});
  assert.match(html,/<details id="workspaceFooterMenu"/);
  const start=html.indexOf('<details id="workspaceFooterMenu"');
  const end=html.indexOf('</details>',start);
  for(const text of ['sidebarMenuPlugins','sidebarMenuTelegram','workspaceFooterAd'])assert.ok(html.slice(start,end).includes(text));
  assert.match(html,/id="workspaceSidebarCollapse"[^>]*aria-label=/);
  assert.match(html,/id="workspaceMobileMenu"[^>]*aria-controls="workspaceSidebar"/);
});
