import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CAMOUFOX_CONFIG_CODE } from '../src/browser/camoufox-runtime.mjs';

test('Camoufox repairs a rounded uint64 WebGL timeout without changing the saved identity', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'camoufox-integer-'));
 try {
  fs.mkdirSync(path.join(dir,'camoufox'));
  fs.writeFileSync(path.join(dir,'camoufox','__init__.py'),'');
  fs.writeFileSync(path.join(dir,'camoufox','utils.py'),`def launch_options(**kwargs):
    saved=kwargs['config']
    assert saved['webGl2:parameters']['37137']==18446744073709551615
    assert saved['canvas:seed']==123
    assert saved['navigator.userAgent']=='saved-identity'
    assert kwargs['i_know_what_im_doing'] is True
    return {'ok':True}
`);
  const fingerprint=path.join(dir,'fingerprint.json');
  fs.writeFileSync(fingerprint,'{"webGl2:parameters":{"37137":18446744073709552000},"canvas:seed":123,"navigator.userAgent":"saved-identity"}');
  const output=path.join(dir,'output.json');
  execFileSync('python3',['-c',CAMOUFOX_CONFIG_CODE,output,'1',fingerprint],{env:{...process.env,PYTHONPATH:dir},stdio:'pipe'});
  assert.equal(JSON.parse(fs.readFileSync(output,'utf8')).ok,true);
  assert.match(fs.readFileSync(fingerprint,'utf8'),/18446744073709551615/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
