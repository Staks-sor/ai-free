// A view of the existing Qwen account page. Pointer events come only from the user.
import { getQwenCaptchaPage } from "../providers/qwen/browser-proxy.mjs";
import { createLiveMjpegHub } from "./live-mjpeg-hub.mjs";
import { captureWebBrowserJpeg } from "./web-browser.mjs";

const hubs = new Map();

export async function handleQwenCaptchaLiveStream(req, res, accountId) {
  if (!await getQwenCaptchaPage(accountId)) throw new Error("Qwen verification page is not ready");
  if (!hubs.has(accountId)) {
    hubs.set(accountId, createLiveMjpegHub({
      boundary: "qwen-captcha-frame",
      minIntervalMs: 100,
      captureFrame: async () => captureWebBrowserJpeg(await getQwenCaptchaPage(accountId)),
    }));
  }
  hubs.get(accountId).attach(req, res);
}

export async function handleQwenCaptchaLiveInput(accountId, body = {}) {
  const page = await getQwenCaptchaPage(accountId);
  if (!page) throw new Error("Qwen verification page is not ready");
  return applyQwenCaptchaPointer(page, body);
}

export async function applyQwenCaptchaPointer(page, body = {}) {
  const type = String(body.type || "");
  if (!["pointerdown", "pointermove", "pointerup"].includes(type)) throw new Error("Unsupported pointer action");
  const viewport = page.viewportSize() || { width: 1280, height: 800 };
  const x = Math.max(0, Math.min(viewport.width - 1, Number(body.x) || 0));
  const y = Math.max(0, Math.min(viewport.height - 1, Number(body.y) || 0));
  await page.mouse.move(x, y);
  if (type === "pointerdown") await page.mouse.down();
  if (type === "pointerup") await page.mouse.up();
  return { ok: true };
}

export function renderEmbedQwenCaptchaHtml(conversationId) {
  const id = encodeURIComponent(conversationId);
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#10131a}#view{position:relative;width:100%;height:100%;touch-action:none;user-select:none}img{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none}</style></head>
<body><div id="view"><img src="/api/conversations/${id}/qwen-captcha/live-stream" alt="Окно проверки Qwen"></div>
<script>
const view=document.getElementById('view'),image=view.querySelector('img');
const endpoint='/api/conversations/${id}/qwen-captcha/live-input';
let held=false,queue=Promise.resolve(),pendingMove=null,moveQueued=false;
function coords(event){const r=view.getBoundingClientRect(),w=image.naturalWidth||1280,h=image.naturalHeight||800,scale=Math.min(r.width/w,r.height/h),left=r.left+(r.width-w*scale)/2,top=r.top+(r.height-h*scale)/2;return{x:Math.round((event.clientX-left)/scale),y:Math.round((event.clientY-top)/scale)}}
function post(type,point){return fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,...point})})}
function send(type,event){const point=coords(event);if(type==='pointermove'){pendingMove=point;if(moveQueued)return;moveQueued=true;queue=queue.catch(()=>{}).then(async()=>{while(pendingMove){const latest=pendingMove;pendingMove=null;await post('pointermove',latest)}moveQueued=false});return}queue=queue.catch(()=>{}).then(()=>post(type,point))}
view.addEventListener('pointerdown',event=>{held=true;view.setPointerCapture(event.pointerId);send('pointerdown',event)});
view.addEventListener('pointermove',event=>{if(held)send('pointermove',event)});
function release(event){if(!held)return;held=false;send('pointerup',event)}
view.addEventListener('pointerup',release);view.addEventListener('pointercancel',release);
</script></body></html>`;
}
