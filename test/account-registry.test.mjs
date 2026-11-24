import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createAccountRegistry} from '../src/providers/account-registry.mjs';
function setup(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'synvox-accounts-'));return {root,registry:createAccountRegistry({root})};}
test('persists ten isolated profiles, rejects the eleventh and preserves selection after restart',()=>{
 const {root,registry:r}=setup();try{const ids=[];for(let n=0;n<10;n++)ids.push(r.add('glm',{label:'Аккаунт '+n}).id);
 assert.throws(()=>r.add('glm'),e=>e.code==='ACCOUNT_LIMIT');r.select('glm',ids[3]);const fresh=createAccountRegistry({root});assert.equal(fresh.read('glm').selectedId,ids[3]);
 assert.equal(new Set(ids.map(id=>fresh.paths('glm',id).profileDir)).size,10);assert.throws(()=>fresh.paths('glm','../escape'));assert.equal(fs.statSync(fresh.paths('glm',ids[0]).authFile.replace(/auth.json$/,'').slice(0,-1)).mode&0o777,0o700);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('metadata snapshots contain no cookies or tokens and removal retains session files',()=>{
 const {root,registry:r}=setup();try{const a=r.add('chatgpt',{label:'Mine',token:'secret'});const paths=r.paths('chatgpt',a.id);fs.writeFileSync(paths.authFile,'saved session');r.select('chatgpt',a.id);r.remove('chatgpt',a.id);assert.equal(r.read('chatgpt').accounts.length,0);assert.equal(fs.readFileSync(paths.authFile,'utf8'),'saved session');assert.doesNotMatch(JSON.stringify(a),/secret|token|cookie/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('two registry instances do not lose independent additions or repeat deleted records',()=>{
 const {root,registry:a}=setup();try{const b=createAccountRegistry({root});const first=a.add('deepseek'),second=b.add('deepseek');a.remove('deepseek',first.id);b.rename('deepseek',second.id,'Second');assert.deepEqual(a.read('deepseek').accounts.map(x=>x.id),[second.id]);assert.equal(a.read('deepseek').accounts[0].label,'Second');}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('corrupt metadata fails closed and never returns injected credentials',()=>{
 const {root,registry:r}=setup();try{r.add('glm');const dir=path.join(root,'glm','metadata');const name=fs.readdirSync(dir).filter(n=>n.endsWith('.json')).sort().at(-1);const file=path.join(dir,name);const record=JSON.parse(fs.readFileSync(file));record.state.accounts[0].token='private';fs.writeFileSync(file,JSON.stringify(record));assert.throws(()=>r.read('glm'),e=>e.code==='ACCOUNT_STORE_CORRUPT');}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('concurrent processes persist independent records with bounded revisions',async()=>{
 const {spawn}=await import('node:child_process');const {root,registry:r}=setup();
 try{const moduleUrl=new URL('../src/providers/account-registry.mjs',import.meta.url).href;
 await Promise.all(Array.from({length:6},()=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,['--input-type=module','-e',`import {createAccountRegistry} from ${JSON.stringify(moduleUrl)};createAccountRegistry({root:process.argv[1]}).add('googleai');`,root],{stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',chunk=>error+=chunk);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(error)));
 })));
 assert.equal(r.read('googleai').accounts.length,6);assert.ok(fs.readdirSync(path.join(root,'googleai','metadata')).filter(n=>n.endsWith('.json')).length<=2);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
