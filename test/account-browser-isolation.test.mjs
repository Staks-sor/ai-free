import test from 'node:test';import assert from 'node:assert/strict';
import {getGLMBrowserLaunchConfig} from '../src/providers/glm/browser-proxy.mjs';
import {getGoogleAIBrowserLaunchConfig} from '../src/providers/google-ai/browser-proxy.mjs';
import {deepSeekCamoufoxOptions} from '../src/browser/login.mjs';
test('GLM and Google launches use the selected isolated profile, not the legacy directory',()=>{
 assert.equal(getGLMBrowserLaunchConfig({profileDir:'/account/glm'}).profileDir,'/account/glm');
 const google=getGoogleAIBrowserLaunchConfig({profileDir:'/account/google',storageStatePath:'/account/storage.json',fingerprintStatePath:'/account/fingerprint.json'});assert.equal(google.profileDir,'/account/google');assert.equal(google.storageStatePath,'/account/storage.json');assert.equal(google.fingerprintStatePath,'/account/fingerprint.json');
});
test('DeepSeek login and refresh options isolate persistent profile and storage',()=>{
 const options=deepSeekCamoufoxOptions(true,{profileDir:'/account/deepseek',storageStatePath:'/account/storage.json',fingerprintStatePath:'/account/fingerprint.json'});assert.equal(options.profileDir,'/account/deepseek');assert.equal(options.storageStatePath,'/account/storage.json');assert.equal(options.fingerprintStatePath,'/account/fingerprint.json');
});
test('ChatGPT extra identities never use the shared embedded profile',async()=>{
 const {getChatGPTAccountLaunchConfig}=await import('../src/providers/chatgpt/browser-proxy.mjs');
 const config=getChatGPTAccountLaunchConfig({accountId:'extra',profileDir:'/account/chatgpt',authFile:'/account/auth.json'});assert.equal(config.embedUi,false);assert.equal(config.profileDir,'/account/chatgpt');assert.equal(config.authFile,'/account/auth.json');
});
