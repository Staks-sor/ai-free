import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writeSavedAuth} from '../src/auth/files.mjs';
import {writeQwenAuth} from '../src/providers/qwen/auth-files.mjs';
import {writeChatGPTAuth} from '../src/providers/chatgpt/auth-files.mjs';
import {writeGoogleAIAuth,invalidateGoogleAIAuth} from '../src/providers/google-ai/auth-files.mjs';
import {writeGLMAuth} from '../src/providers/glm/auth-files.mjs';
for(const [provider,write] of Object.entries({deepseek:writeSavedAuth,qwen:writeQwenAuth,chatgpt:writeChatGPTAuth,googleai:writeGoogleAIAuth,glm:writeGLMAuth})){
 test(`${provider} preserves the saved session on a failed replacement`,t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'synvox-auth-atomic-')),file=path.join(root,'auth.json');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  write(file,{cookies:[],token:'fixture',userToken:'fixture',accessToken:'fixture',profileDir:root});const previous=fs.readFileSync(file,'utf8');
  const rename=fs.renameSync;fs.renameSync=()=>{throw new Error('simulated disk failure');};
  try{assert.throws(()=>write(file,{cookies:[],token:'new',userToken:'new',accessToken:'new',profileDir:root}),/disk failure/);}finally{fs.renameSync=rename;}
  assert.equal(fs.readFileSync(file,'utf8'),previous);assert.equal(fs.statSync(file).mode&0o777,0o600);assert.deepEqual(fs.readdirSync(root),['auth.json']);
 });
}
test('Google auth invalidation is atomic and retains its metadata',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'synvox-auth-invalidate-')),file=path.join(root,'auth.json');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 writeGoogleAIAuth(file,{profileDir:root,accountLabel:'Fixture'});const rename=fs.renameSync;fs.renameSync=()=>{throw new Error('simulated disk failure');};
 try{assert.throws(()=>invalidateGoogleAIAuth(file),/disk failure/);}finally{fs.renameSync=rename;}
 assert.equal(JSON.parse(fs.readFileSync(file)).signedIn,true);invalidateGoogleAIAuth(file);const saved=JSON.parse(fs.readFileSync(file));assert.equal(saved.signedIn,false);assert.equal(saved.accountLabel,'Fixture');
});
test('ChatGPT retains a confirmed identity for cookie-only sessions',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'synvox-chatgpt-identity-')),file=path.join(root,'auth.json');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 writeChatGPTAuth(file,{cookies:[],sessionToken:'fixture',accountIdentity:'confirmed-user'});assert.equal(JSON.parse(fs.readFileSync(file)).accountIdentity,'confirmed-user');
});
