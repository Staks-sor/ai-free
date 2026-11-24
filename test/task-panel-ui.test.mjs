import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderWindowHtml } from '../src/window-app/ui-html.mjs';
import fs from 'node:fs';

test('saved agents and tasks expose scoped controls and evidence without a new polling loop',()=>{
 const html=renderWindowHtml({language:'ru'});
 assert.match(html,/id="taskPanelBtn"/);assert.match(html,/id="taskPanelOverlay"/);
 assert.match(html,/stop.textContent = t\("tasks.stop"\)/);
 assert.match(html,/function renderTaskPanel\(/);assert.match(html,/summary.roleId !== "assistant"/);
 assert.match(html,/resumeTaskId: view.id/);assert.match(html,/if \(!view\?\.canResume \|\| view.id !== taskId\)/);
 assert.match(html,/newRoleSelect.value = "developer"/);
 assert.match(html,/taskPanelOverlay.classList.contains\("hidden"\)/);
 const renderer=html.slice(html.indexOf('function renderTaskPanel('),html.indexOf('// ---- New chat modal ----'));
 assert.doesNotMatch(renderer,/setInterval|innerHTML = .*goal|stdout|checkpoint\.prompt/);
 const server=fs.readFileSync(new URL('../src/window-app/server.mjs',import.meta.url),'utf8');
 assert.match(server,/assertTaskContinuation\(conversation, body.resumeTaskId/);
});
