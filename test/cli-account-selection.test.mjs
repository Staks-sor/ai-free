import test from 'node:test';import assert from 'node:assert/strict';
import {selectCLIAccount} from '../src/cli/account-selection.mjs';import {DEFAULT_AUTH_FILE,DEFAULT_COOKIE_FILE} from '../src/config.mjs';
test('CLI uses the saved primary DeepSeek account but respects explicit credentials and window bootstrap',()=>{
 const manager={selected:()=> 'extra',resolve:()=>({id:'extra',paths:{authFile:'/isolated/auth.json',profileDir:'/isolated/profile'}})};
 const args={authFile:DEFAULT_AUTH_FILE,cookies:DEFAULT_COOKIE_FILE,token:''};assert.equal(selectCLIAccount(args,{manager}).paths.authFile,'/isolated/auth.json');
 for(const override of [{authFile:'/custom/auth'},{cookies:'/custom/cookies'},{token:'explicit'},{window:true}])assert.equal(selectCLIAccount({...args,...override},{manager}),null);
 assert.equal(selectCLIAccount(args,{manager,argv:['--cookies',DEFAULT_COOKIE_FILE]}),null);
});
