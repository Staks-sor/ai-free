import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function fixture(resolveRuntime){
 const view={webview:{html:'',options:{}}};let provider;
 const output={appendLine(){},append(){},show(){}};
 const vscode={workspace:{workspaceFolders:[]},window:{createOutputChannel:()=>output,showErrorMessage:async()=>undefined,
  registerWebviewViewProvider(_id,value){provider=value;provider.resolveWebviewView(view);return {dispose(){}};}}};
 const context=vm.createContext({require:name=>name==='vscode'?vscode:name==='./node-runtime'?{REQUIRED_NODE_MAJOR:22,resolveNodeRuntime:resolveRuntime}:require(name),
  module:{exports:{}},__dirname:'/synthetic/plugin',process,console,setTimeout,clearTimeout});
 vm.runInContext(fs.readFileSync(new URL('../plugin-for-vscode/extension.js',import.meta.url),'utf8')+'\nglobalThis.WebviewProvider=AIWebviewViewProvider;',context);
 return {view,context,activate:()=>context.module.exports.activate({subscriptions:[]}),provider:()=>provider};
}
test('sidebar renders loading before the asynchronous Node probe completes',async()=>{
 let done;const f=fixture(()=>new Promise(resolve=>{done=resolve;}));const activation=f.activate();
 assert.ok(f.provider(),'register the view before awaiting Node');assert.match(f.view.webview.html,/Запускаем SYNVOX/);
 done({ok:false,attempts:['Node unavailable']});await activation;
});
test('Node startup failure renders a visible escaped error instead of a black sidebar',async()=>{
 const f=fixture(async()=>({ok:false,attempts:['<runtime unavailable>']}));await f.activate();
 assert.match(f.view.webview.html,/SYNVOX не запустился/);assert.match(f.view.webview.html,/Node\.js 22/);
 assert.match(f.view.webview.html,/&lt;runtime unavailable&gt;/);assert.doesNotMatch(f.view.webview.html,/<runtime unavailable>/);
});
test('ready sidebar embeds the same loopback server on every platform and can show a stopped-server error',()=>{
 const f=fixture(async()=>({ok:false,attempts:[]}));const provider=new f.context.WebviewProvider();provider.resolveWebviewView(f.view);
 provider.setPort(4320);assert.match(f.view.webview.html,/<iframe src="http:\/\/127\.0\.0\.1:4320\/"/);
 provider.setError('server stopped');assert.match(f.view.webview.html,/server stopped/);assert.doesNotMatch(f.view.webview.html,/<iframe/);
});

test('webview maps the UI loopback port to the extension host for remote workspaces',()=>{
 const f=fixture(async()=>({ok:false,attempts:[]}));const p=new f.context.WebviewProvider();p.resolveWebviewView(f.view);p.setPort(4321);
 assert.equal(f.view.webview.options.portMapping?.[0]?.webviewPort,4321);assert.equal(f.view.webview.options.portMapping[0].extensionHostPort,4321);
});
