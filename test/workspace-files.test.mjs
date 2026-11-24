import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {handleWorkspaceFilesRequest} from '../src/window-app/workspace-files.mjs';
async function request(state, pathname, method='GET') {let sent;const handled=await handleWorkspaceFilesRequest({method},{},new URL(pathname,'http://localhost'),{state,sendJson:(_res,data,status=200)=>{sent={data,status}}});return {handled,...sent};}
test('file tree and bounded contents are scoped to a saved conversation workspace',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-files-'));
 try{fs.writeFileSync(path.join(root,'app.js'),'export const x=1;');const state={conversations:[{id:'chat',workspace:root}]};
 assert.deepEqual((await request(state,'/api/conversations/chat/files')).data.entries,['app.js']);
 assert.equal((await request(state,'/api/conversations/chat/files?path=app.js')).data.content,'export const x=1;');
 assert.equal((await request(state,'/api/conversations/missing/files')).status,404);
 assert.equal((await request(state,'/api/conversations/chat/files','POST')).status,405);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('files route rejects escaped, symlinked and protected paths without reading private contents',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-files-')),other=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-other-'));
 try{fs.writeFileSync(path.join(other,'secret'),'PRIVATE');fs.writeFileSync(path.join(root,'.env'),'PRIVATE');fs.symlinkSync(other,path.join(root,'link'));const state={conversations:[{id:'chat',workspace:root}]};
 for(const p of ['../secret','.env','link/secret']){const r=await request(state,'/api/conversations/chat/files?path='+encodeURIComponent(p));assert.equal(r.status,403);assert.doesNotMatch(JSON.stringify(r.data),/PRIVATE/)}
 }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(other,{recursive:true,force:true})}
});
