import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

describe("ChatGPT browser retry safety", () => {
  it("does not retry an uncertain submission in the desktop or VS Code server", () => {
    for (const file of ["src/window-app/server.mjs", "plugin-for-vscode/src/window-app/server.mjs"]) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const body = source.slice(source.indexOf("async function chatGPTApiCall"), source.indexOf("async function chatGPTApiCall") + 2400);
      assert.match(body, /if \(error\?\.promptSubmitted\) throw error;/, file);
      assert.match(body, /error\?\.delivery !== "not_sent"/, file);
      assert.doesNotMatch(body, /transportResetDone|isChatGPTTransportError/, file);
    }
  });
});

describe('single browser attempt and Stop', () => {
  it('marks ambiguous send unknown and stops generation once on cancellation', async () => {
    const {runChatGPTBrowserSend}=await import('../src/providers/chatgpt/browser-proxy.mjs');
    const controller=new AbortController();let sends=0,stops=0;
    await assert.rejects(runChatGPTBrowserSend(async({attemptState,signal})=>{
      sends++;attemptState.promptSubmitted=true;controller.abort();signal.throwIfAborted();
    },{signal:controller.signal},async()=>{stops++;}),e=>e.name==='AbortError'&&e.delivery==='unknown'&&e.promptSubmitted===true);
    assert.equal(sends,1);assert.equal(stops,1);
  });
  it('marks a failure before send not_sent without replay or stopping another generation', async () => {
    const {runChatGPTBrowserSend}=await import('../src/providers/chatgpt/browser-proxy.mjs');
    let sends=0,stops=0;
    await assert.rejects(runChatGPTBrowserSend(async()=>{sends++;throw new Error('Target closed');},{},async()=>{stops++;}),e=>e.delivery==='not_sent'&&e.promptSubmitted===false);
    assert.equal(sends,1);assert.equal(stops,0);
  });
  it('forwards Stop through the coding adapter without consuming unsent images', async () => {
    const {createChatGPTAgentAdapter}=await import('../src/providers/chatgpt/agent-adapter.mjs');
    const controller=new AbortController();let received;
    const adapter=createChatGPTAgentAdapter({complete:async args=>{received=args;return {text:'ok'};}},{images:[{name:'test.png'}]});
    controller.abort();await assert.rejects(adapter.complete({prompt:'cancelled',signal:controller.signal}),{name:'AbortError'});
    assert.equal(received,undefined);
    const next=new AbortController();await adapter.complete({prompt:'next',signal:next.signal});
    assert.equal(received.signal,next.signal);assert.equal(received.images.length,1);
  });
});
