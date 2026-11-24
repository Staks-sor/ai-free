import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const runtimeUrl = new URL('../src/browser/camoufox-runtime.mjs', import.meta.url).href;
function scenario(t, mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-cold-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const python = path.join(dir, 'python');
  fs.writeFileSync(python, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');const a=process.argv.slice(2),root=process.env.COLD_HOME;
fs.appendFileSync(path.join(root,'commands'),JSON.stringify(a)+'\\n');
if(a.includes('--version')&&a[0]!=='-m'){console.log('Python 3.12.7');process.exit(0);}
if(a[1]==='venv'){for(const p of ['bin/python','Scripts/python.exe']){const dest=path.join(a[2],p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(__filename,dest);fs.chmodSync(dest,0o755);}process.exit(0);}
if(a[0]==='-c'){process.exit(fs.existsSync(path.join(root,'installed'))?0:1);}
if(a[1]==='pip'&&a[2]==='--version'){process.exit(fs.existsSync(path.join(root,'pip'))?0:1);}
if(a[1]==='ensurepip'){fs.writeFileSync(path.join(root,'pip'),'1');process.exit(0);}
const stage=a[1]==='pip'?'package':'browser';
if(process.env.COLD_FAIL===stage&&!fs.existsSync(path.join(root,'failed'))){fs.writeFileSync(path.join(root,'failed'),'1');console.error('proxy private-password unavailable');process.exit(1);}
if(stage==='browser')fs.writeFileSync(path.join(root,'installed'),'1');
`, { mode: 0o755 });
  const script = `import fs from 'node:fs';import os from 'node:os';os.homedir=()=>process.env.COLD_HOME;Object.defineProperty(process,'platform',{value:'linux'});
const {ensureCamoufoxInstalled,getCamoufoxInstallState}=await import(${JSON.stringify(runtimeUrl)});
const sentinel=process.env.COLD_HOME+'/saved-session.json';fs.writeFileSync(sentinel,'retained');
if(process.env.COLD_MODE==='permissions')fs.writeFileSync(process.env.COLD_HOME+'/.deepseek-cli','blocked');
if(process.env.COLD_MODE==='legacy'){
const old=process.env.COLD_HOME+'/.deepseek-cli/camoufox/venv/bin/python';fs.mkdirSync(new URL('.', 'file://'+old),{recursive:true});
fs.writeFileSync(old,'#!'+process.execPath+'\\nif(process.argv.includes(\"--version\")){console.log(\"Python 3.9.8\");}else{process.exit(1);}',{mode:0o755});
}
let first;
try{await Promise.all([ensureCamoufoxInstalled(),ensureCamoufoxInstalled()]);first={ok:true};}catch(e){first={code:e.code,message:e.userMessage,delivery:e.delivery};}
let retried=false;
if(process.env.COLD_FAIL){await ensureCamoufoxInstalled();retried=true;}
console.log(JSON.stringify({first,retried,state:getCamoufoxInstallState().phase,saved:fs.readFileSync(sentinel,'utf8'),backups:fs.existsSync(process.env.COLD_HOME+'/.deepseek-cli/camoufox')?fs.readdirSync(process.env.COLD_HOME+'/.deepseek-cli/camoufox').filter(p=>p.startsWith('venv-backup-')).length:0}));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env,
    COLD_HOME: dir, COLD_MODE: mode, COLD_FAIL: ['package','browser'].includes(mode) ? mode : '',
    AI_FREE_CAMOUFOX_PYTHON: python, AI_FREE_CAMOUFOX_AUTO_INSTALL: mode==='disabled'?'0':'1' }, timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  return { ...JSON.parse(result.stdout.trim()), commands: fs.existsSync(path.join(dir, 'commands')) ? fs.readFileSync(path.join(dir,'commands'),'utf8').trim().split('\n').map(JSON.parse) : [] };
}
test('cold setup bootstraps pip and shares one install across simultaneous logins',t=>{
 const r=scenario(t,'success');assert.equal(r.first.ok,true);assert.equal(r.state,'ready');assert.equal(r.saved,'retained');
 assert.equal(r.commands.filter(a=>a[1]==='venv').length,1);assert.equal(r.commands.filter(a=>a[1]==='ensurepip').length,1);assert.equal(r.commands.filter(a=>a[1]==='pip'&&a[2]==='install').length,1);
});
for(const stage of ['package','browser'])test(`cold ${stage} network failure is actionable and retry preserves saved sessions`,t=>{
 const r=scenario(t,stage);assert.equal(r.first.code,`CAMOUFOX_${stage.toUpperCase()}_FAILED`);assert.equal(r.first.delivery,'not_sent');assert.doesNotMatch(r.first.message,/private-password/);assert.equal(r.retried,true);assert.equal(r.state,'ready');assert.equal(r.saved,'retained');assert.equal(r.commands.filter(a=>a[1]==='venv').length,1);
});
test('blocked runtime directory gives an actionable setup failure',t=>{const r=scenario(t,'permissions');assert.equal(r.first.code,'CAMOUFOX_RUNTIME_FAILED');assert.match(r.first.message,/права/);});
test('explicitly disabled installation explains why no browser opens',t=>{const r=scenario(t,'disabled');assert.equal(r.first.code,'CAMOUFOX_INSTALL_DISABLED');assert.match(r.first.message,/отключена/);});

test('an old Python 3.9 browser environment is backed up and rebuilt with compatible Python',t=>{const r=scenario(t,'legacy');assert.equal(r.first.ok,true);assert.equal(r.backups,1);assert.equal(r.saved,'retained');assert.equal(r.state,'ready');});
