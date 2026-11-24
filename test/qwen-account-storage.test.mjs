import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {addAccount,loadAccounts,saveAccounts,getAccountProfileDir} from '../src/providers/qwen/account-store.mjs';
test('all Qwen additions enforce ten accounts and profile paths reject traversal',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qwen-storage-'));process.env.QWEN_ACCOUNTS_FILE=path.join(root,'accounts.json');
 t.after(()=>{delete process.env.QWEN_ACCOUNTS_FILE;fs.rmSync(root,{recursive:true,force:true});});
 for(let n=0;n<10;n++)addAccount({id:'a'+n,token:'token'+n});
 assert.throws(()=>addAccount({id:'overflow'}),/10 аккаунтов/);assert.equal(loadAccounts().length,10);assert.throws(()=>getAccountProfileDir('../escape'));
});
test('a failed atomic save retains the previous readable account file',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qwen-storage-failure-'));process.env.QWEN_ACCOUNTS_FILE=path.join(root,'accounts.json');
 t.after(()=>{delete process.env.QWEN_ACCOUNTS_FILE;fs.rmSync(root,{recursive:true,force:true});});
 saveAccounts([{id:'existing',token:'saved'}]);
 const rename=fs.renameSync;fs.renameSync=()=>{throw new Error('simulated disk failure');};
 try{assert.throws(()=>saveAccounts([{id:'new',token:'unsaved'}]),/disk failure/);}finally{fs.renameSync=rename;}
 assert.equal(loadAccounts()[0].id,'existing');assert.equal(fs.statSync(process.env.QWEN_ACCOUNTS_FILE).mode&0o777,0o600);
 assert.equal(fs.readdirSync(root).filter(n=>n.endsWith('.tmp')).length,0);
});
