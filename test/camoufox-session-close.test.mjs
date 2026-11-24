import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {writeAtomicJsonSync} from '../src/state/state-writer.mjs';
function fixture(t,context,browser=null){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'synvox-close-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const state=path.join(dir,'storage.json');fs.writeFileSync(state,JSON.stringify({cookies:[{name:'saved',value:'retained'}],origins:[]}));
 const code=fs.readFileSync(new URL('../src/browser/camoufox-runtime.mjs',import.meta.url),'utf8');const body=code.slice(code.lastIndexOf('  let closed = false;'),code.lastIndexOf('\n}'));
 let checkpoint;const timers=[];const sandbox={context,browser,storageStatePath:state,page:{},fs,path,writeAtomicJsonSync,
  setInterval:(fn,ms)=>{assert.equal(ms,30_000);checkpoint=fn;return {unref(){}};},clearInterval(){},setTimeout:(fn,ms)=>{const id=setTimeout(fn,Math.min(ms,8));timers.push(id);return id;},clearTimeout,
  console:{warn(){},log(){}}};t.after(()=>timers.forEach(clearTimeout));
 const session=vm.runInNewContext('(function(){'+body+'})()',sandbox);
 return {session,state,checkpoint:()=>checkpoint()};
}
const within=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('test close remained blocked')),80);})]);}finally{clearTimeout(timer);}};
test('a stuck storage export cannot block closing the login window or erase the saved snapshot',async t=>{
 let release,closes=0;const context={storageState:()=>new Promise(r=>{release=r;}),close:async()=>{closes++;}};
 const {session,state}=fixture(t,context);try{await within(session.close());assert.equal(closes,1);assert.equal(JSON.parse(fs.readFileSync(state)).cookies[0].value,'retained');}
 finally{release?.({cookies:[],origins:[]});}
});
test('a stuck persistent context falls back to closing its own browser',async t=>{
 let release,closes=0;const browser={close:async()=>{closes++;release?.();}};
 const context={storageState:async()=>({cookies:[],origins:[]}),close:()=>new Promise(r=>{release=r;}),browser:()=>browser};
 const {session}=fixture(t,context);try{await within(session.close());assert.equal(closes,1);}finally{release?.();}
});
test('simultaneous closes share the final save and close exactly once',async t=>{
 let saves=0,closes=0;const context={storageState:async()=>{saves++;return {cookies:[],origins:[]};},close:async()=>{closes++;}};
 const {session}=fixture(t,context);await within(Promise.all([session.close(),session.close()]));assert.equal(saves,1);assert.equal(closes,1);
});
test('a late storage reply after the deadline cannot overwrite the preserved snapshot',async t=>{
 let release;const context={storageState:()=>new Promise(r=>{release=r;}),close:async()=>{}};
 const {session,state}=fixture(t,context);try{await within(session.close());release({cookies:[],origins:[]});await new Promise(r=>setImmediate(r));assert.equal(JSON.parse(fs.readFileSync(state)).cookies[0].value,'retained');}finally{release?.({cookies:[],origins:[]});}
});
test('a browser that cannot close produces a bounded actionable error and allows a later close retry',async t=>{
 let stuck=true;const browser={close:()=>stuck?new Promise(()=>{}):Promise.resolve()};
 const context={storageState:async()=>({cookies:[],origins:[]}),close:()=>stuck?new Promise(()=>{}):Promise.resolve(),browser:()=>browser};
 const {session}=fixture(t,context);await assert.rejects(within(session.close()),e=>e.code==='CAMOUFOX_CLOSE_TIMEOUT'&&/Перезапустите/.test(e.userMessage));stuck=false;await within(session.close());
});

test('periodic checkpoints atomically save refreshed storage while the session stays open',async t=>{
 const refreshed={cookies:[{name:'refreshed',value:'synthetic'}],origins:[]};let calls=0;
 const context={storageState:async()=>{calls++;return refreshed;},close:async()=>{}};
 const {session,state,checkpoint}=fixture(t,context);checkpoint();await session.persistStorageState();
 assert.equal(calls,1);assert.deepEqual(JSON.parse(fs.readFileSync(state)),refreshed);assert.equal(fs.statSync(state).mode&0o777,0o600);await session.close();
});
