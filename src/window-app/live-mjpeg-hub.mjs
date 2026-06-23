// Один цикл скриншотов → много MJPEG-подписчиков (без N параллельных capture).

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function frameSignature(buf) {
  if (!buf?.length) return 0;
  const mid = buf[Math.floor(buf.length / 2)] || 0;
  const tail = buf[buf.length - 1] || 0;
  return (buf.length ^ (mid << 8) ^ tail) >>> 0;
}

function writeMjpegFrame(res, boundary, buf) {
  res.write(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`);
  res.write(buf);
  res.write("\r\n");
}

export function createLiveMjpegHub({
  boundary,
  minIntervalMs = 100,
  forceIntervalMs = 1200,
  captureFrame,
} = {}) {
  /** @type {Set<import("node:http").ServerResponse>} */
  const subscribers = new Set();
  let loopPromise = null;
  let lastFrame = null;
  let lastSig = 0;
  let lastSentAt = 0;

  function unsubscribe(res) {
    subscribers.delete(res);
  }

  function attach(req, res) {
    res.writeHead(200, {
      "Content-Type": `multipart/x-mixed-replace; boundary=${boundary}`,
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const onClose = () => unsubscribe(res);
    req.on("close", onClose);
    req.on("aborted", onClose);

    subscribers.add(res);
    if (lastFrame) {
      try { writeMjpegFrame(res, boundary, lastFrame); } catch { unsubscribe(res); }
    }
    ensureLoop();
  }

  function ensureLoop() {
    if (loopPromise) return;
    loopPromise = runLoop().finally(() => {
      loopPromise = null;
      if (subscribers.size > 0) ensureLoop();
    });
  }

  async function runLoop() {
    while (subscribers.size > 0) {
      const started = Date.now();
      try {
        const buf = await captureFrame();
        const sig = frameSignature(buf);
        const stale = Date.now() - lastSentAt >= forceIntervalMs;
        if (sig !== lastSig || stale) {
          lastSig = sig;
          lastFrame = buf;
          lastSentAt = Date.now();
          for (const res of subscribers) {
            try {
              writeMjpegFrame(res, boundary, buf);
            } catch {
              unsubscribe(res);
            }
          }
        }
      } catch {
        await sleep(250);
      }
      const elapsed = Date.now() - started;
      const wait = Math.max(0, minIntervalMs - elapsed);
      if (wait) await sleep(wait);
    }
  }

  function reset() {
    lastFrame = null;
    lastSig = 0;
    lastSentAt = 0;
  }

  return { attach, reset, subscriberCount: () => subscribers.size };
}
