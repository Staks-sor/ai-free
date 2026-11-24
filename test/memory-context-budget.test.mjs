import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
let root,store,context,db;
before(async()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'synvox-rag-'));process.env.AI_FREE_MEMORY_DIR=root;store=await import('../src/memory/store.mjs');context=await import('../src/memory/context-builder.mjs');db=await import('../src/memory/db.mjs');db.resetMemoryBackendForTests();});
after(async()=>{db.resetMemoryBackendForTests();(await import('../src/memory/graph/store.mjs')).resetGraphBackendForTests();delete process.env.AI_FREE_MEMORY_DIR;fs.rmSync(root,{recursive:true,force:true});});
test('memory and anti-repeat share one UTF-8 budget and source references',()=>{
 store.addMemory({id:'huge',type:'error',content:'timeout ошибка '.repeat(2000),workspace:'/project/a',meta:{important:true}});
 const r=context.buildMemoryContextResult('timeout ошибка','/project/a',{maxContextBytes:1024});
 assert.ok(Buffer.byteLength(r.context)<=1024);assert.ok(r.context.includes('huge'));assert.equal(r.truncated,true);
});
test('memory cache is bounded, isolated, and invalidated by writes and deletion',()=>{
 const options={forceMemory:true,maxContextBytes:2048};
 store.addMemory({id:'cache',type:'fix',content:'timeout repair initial',workspace:'/project/cache',meta:{important:true}});
 const first=context.buildMemoryContextResult('timeout repair','/project/cache',options);assert.equal(first.cacheHit,false);
 const second=context.buildMemoryContextResult('timeout repair','/project/cache',options);assert.equal(second.cacheHit,true);
 store.addMemory({id:'cache',type:'fix',content:'timeout repair changed',workspace:'/project/cache',meta:{important:true}});
 assert.match(context.buildMemoryContextResult('timeout repair','/project/cache',options).context,/changed/);
 store.deleteMemory('cache');assert.equal(context.buildMemoryContextResult('timeout repair','/project/cache',options).context,'');
});
test('empty workspace never leaks project-specific memory',()=>{
 store.addMemory({id:'private',type:'fix',content:'timeout workspace private marker',workspace:'/project/private',meta:{important:true}});
 assert.doesNotMatch(context.buildMemoryContextResult('timeout workspace private marker','',{forceMemory:true}).context,/private marker/);
});
test('cache detects a canonical memory change from another process',async()=>{
 const {execFileSync}=await import('node:child_process');const url=new URL('../src/memory/store.mjs',import.meta.url).href;
 const options={forceMemory:true};store.addMemory({id:'external',type:'fix',content:'external timeout initial',workspace:'/project/external',meta:{important:true}});
 context.buildMemoryContextResult('external timeout','/project/external',options);
 assert.equal(context.buildMemoryContextResult('external timeout','/project/external',options).cacheHit,true);
 execFileSync(process.execPath,['--input-type=module','-e',`import {addMemory} from ${JSON.stringify(url)};addMemory({id:'external',type:'fix',content:'external timeout changed',workspace:'/project/external',meta:{important:true}});`],{env:{...process.env,AI_FREE_MEMORY_DIR:root},stdio:'pipe'});
 const result=context.buildMemoryContextResult('external timeout','/project/external',options);assert.equal(result.cacheHit,false);assert.match(result.context,/changed/);
});
