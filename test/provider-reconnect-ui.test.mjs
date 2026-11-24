import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {renderWindowHtml} from '../src/window-app/ui-html.mjs';

test('reconnect waits for login completion even when the old saved session is usable',async()=>{
 const html=renderWindowHtml({language:'ru'});
 const start=html.indexOf('async function connectProvider(');
 const end=html.indexOf('\n    async function ',start+1);
 const alerts=[],statuses=[];let refreshes=0;
 const login=new Map([['glm',{state:'running'}]]);
 const sandbox={PROVIDER_INFO:{glm:{label:'GLM'}},newChatProviderPicker:{querySelector:()=>null},
  fetch:async()=>({ok:true,json:async()=>({loginStarted:true})}),setTimeout:fn=>fn(),
  refreshAvailableProviders:async()=>{refreshes++;if(refreshes>=2)login.set('glm',{state:'completed'});},
  providerLoginStates:login,availableProviders:['glm'],alert:value=>alerts.push(value),setStatus:value=>statuses.push(value),
  t:key=>key,renderProviderPicker:()=>{},renderModePickerForProvider:()=>{}};
 vm.createContext(sandbox);vm.runInContext(html.slice(start,end)+';globalThis.connect=connectProvider;',sandbox);
 await sandbox.connect('glm',{preserveSelection:true});
 assert.equal(refreshes,2,'old auth must not prematurely finish reconnect');assert.deepEqual(alerts,['provider.connectedAlert']);
 assert.deepEqual(statuses,['Ожидаем завершения входа…']);
});
