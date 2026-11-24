import test from 'node:test';import assert from 'node:assert/strict';
import * as runtime from '../src/browser/camoufox-runtime.mjs';
test('Python discovery rejects old versions and the Store alias, then uses a compatible candidate',async()=>{
 const calls=[];const result=await runtime.findPython({platform:'win32',configured:'',execute:async(cmd,args)=>{calls.push([cmd,args]);return {output:cmd==='py'?'Python 3.9.8':'Python 3.12.7'};}});
 assert.equal(result.command,'python');assert.equal(calls.length,2);
});
test('missing and unsupported Python have actionable codes instead of a generic login failure',async()=>{
 for(const output of [null,'Python 2.7.18','Python 3.9.1','Python'])await assert.rejects(runtime.findPython({platform:'linux',configured:'',execute:async()=>{if(output===null)throw new Error('ENOENT');return {output};}}),e=>/^CAMOUFOX_PYTHON_/.test(e.code)&&/3\.10/.test(e.userMessage));
});
test('browser setup stages expose safe errors without leaking subprocess details',()=>{
 for(const phase of ['runtime','package','browser','launch']){const e=runtime.browserSetupError(phase,new Error('proxy https://user:private-password@example.invalid failed'));
 assert.match(e.code,/^CAMOUFOX_/);assert.equal(e.delivery,'not_sent');assert.equal(e.message,e.userMessage);assert.doesNotMatch(e.userMessage,/private-password/);}
});
test('active browser preparation is distinguishable from waiting for account login',()=>{
 for(const phase of ['python','runtime','package','browser']){const s=runtime.getBrowserLoginProgress({state:'running'},{phase,message:'Preparing '+phase});assert.equal(s.phase,phase);assert.equal(s.message,'Preparing '+phase);}
 assert.equal(runtime.getBrowserLoginProgress({state:'running'},{phase:'ready'}).phase,'login');
 assert.deepEqual(runtime.getBrowserLoginProgress({state:'done'},{phase:'error'}),{state:'done'});
});

test('interactive Linux login without a display fails before downloading or opening a hidden browser',async()=>{
 const previous=Object.getOwnPropertyDescriptor(process,'platform'),display=process.env.DISPLAY,wayland=process.env.WAYLAND_DISPLAY;
 try{Object.defineProperty(process,'platform',{value:'linux'});delete process.env.DISPLAY;delete process.env.WAYLAND_DISPLAY;
 await assert.rejects(runtime.launchCamoufoxSession({headless:false}),e=>e.code==='CAMOUFOX_DISPLAY_REQUIRED'&&/WSL/.test(e.userMessage));
 }finally{Object.defineProperty(process,'platform',previous);if(display===undefined)delete process.env.DISPLAY;else process.env.DISPLAY=display;if(wayland===undefined)delete process.env.WAYLAND_DISPLAY;else process.env.WAYLAND_DISPLAY=wayland;}
});


test('provider login progress is retained after browser setup completes',()=>{
 const progress={state:'running',phase:'captcha',message:'hCaptcha не подтвердила проверку.'};
 assert.deepEqual(runtime.getBrowserLoginProgress(progress,{phase:'ready'}),progress);
});
