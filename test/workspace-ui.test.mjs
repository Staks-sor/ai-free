import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {renderWindowHtml} from '../src/window-app/ui-html.mjs';
import {getWorkspaceBoardItems,getWorkspaceProjects} from '../src/window-app/workspace-ui-script.mjs';
test('workspace board uses real task projections with phases/history and workspace filtering',()=>{
 const state={workspaceRoot:'/a',runningTaskIds:['a'],conversations:[{id:'a',workspace:'/a',title:'A',taskView:{id:'t1',status:'running',verification:'not_run',currentTool:'verify_task'},taskHistoryView:[{id:'old',status:'completed',verification:'passed'}]}, {id:'b',workspace:'/b',title:'B',taskView:{id:'t2',status:'failed',verification:'failed'}}]};
 const items=getWorkspaceBoardItems(state,'/a');assert.equal(items.length,2);assert.equal(items[0].column,'working');assert.equal(items[0].view.canStop,true);assert.equal(items[1].view.canStop,false);assert.equal(items[1].view.canResume,false);assert.equal(getWorkspaceBoardItems(state,'/b')[0].column,'help');assert.equal(getWorkspaceBoardItems({conversations:[{id:'empty'}]},'' ).length,0);
 assert.deepEqual(getWorkspaceProjects(state).map(p=>p.path),['/a','/b']);
});
test('product HTML integrates workspace tabs, inspector, real files and keeps existing forms',()=>{
 const html=renderWindowHtml({language:'ru'});for(const id of ['workspaceProjectList','workspaceBoard','workspaceInspector','workspaceFiles','workspaceDiscuss','workspaceExecute','messageInput','settingsOverlay','taskPanelOverlay'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/workspaceChatPane/);assert.match(html,/setupWorkspaceUi/);assert.doesNotMatch(html,/Демонстрационн|Пример ответа|Плавное управление персонажем/);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.ok(scripts.length);for(const [,code] of scripts)new vm.Script(code);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'no duplicate DOM ids');
});
