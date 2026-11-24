import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWindowState} from '../src/state/window-state.mjs';
import {conversationList} from '../src/state/conversations.mjs';
import {resolveConversationAgentTask} from '../src/window-app/agent-task.mjs';
test('explicit discussion mode survives normalization and prevents automatic workspace dispatch',()=>{
 const c={id:'chat',provider:'deepseek',workspace:'/project',interactionMode:'discuss',coderMode:false,messages:[]};
 const normalized=normalizeWindowState({conversations:[c]},"/project");assert.equal(normalized.conversations[0].coderMode,false);assert.equal(conversationList(normalized)[0].coderMode,false);assert.equal(conversationList(normalized)[0].interactionMode,'discuss');
 assert.equal(resolveConversationAgentTask('исправь файл',c,{autoCodeMode:true}).run,false);
 assert.equal(resolveConversationAgentTask('/code исправь файл',c).run,true);
});
