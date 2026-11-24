import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderWindowHtml } from '../src/window-app/ui-html.mjs';

test('task handoff uses the new-chat provider and role form without auto-sending',()=>{
 const html=renderWindowHtml({language:'ru'});
 assert.match(html,/id="handoffTaskBtn"/);
 assert.match(html,/id="newRole"/);
 assert.match(html,/handoffFrom: pendingHandoffFrom/);
 assert.match(html,/roleId: newRoleSelect.value/);
 assert.match(html,/newWorkspaceInput.readOnly = Boolean\(source\)/);
 assert.match(html,/messageInput.value = "\/code Продолжи переданную задачу/);
 assert.match(html,/pendingHandoffFrom = null/);
});
