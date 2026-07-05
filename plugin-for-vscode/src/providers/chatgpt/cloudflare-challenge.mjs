// Cloudflare Turnstile: детекция и клики. Headed Chrome + человеческий ввод из MJPEG-панели.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function cloudflareChallengeEvaluator() {
  const title = String(document.title || "").toLowerCase();
  const bodyText = String(document.body?.innerText || "").slice(0, 4000).toLowerCase();
  const hasComposer = Boolean(
    document.querySelector("#prompt-textarea")
      || document.querySelector('div[contenteditable="true"]')
      || document.querySelector("textarea"),
  );
  if (hasComposer) {
    return { hasComposer: true, challenge: false, url: location.href };
  }
  const hasTurnstile = Boolean(
    document.querySelector('iframe[src*="challenges.cloudflare.com"]')
      || document.querySelector('iframe[src*="turnstile"]')
      || document.querySelector("#challenge-stage")
      || document.querySelector(".ctp-checkbox-label"),
  );
  const hasChallengeText = /just a moment|checking your browser|verify you are human|confirm you are human|подтвердите.*человек|идет проверка|один момент/i.test(
    `${title}\n${bodyText}`,
  );
  return {
    hasComposer: false,
    challenge: hasTurnstile || hasChallengeText,
    url: location.href,
  };
}

export async function detectCloudflareChallenge(page) {
  try {
    return await page.evaluate(cloudflareChallengeEvaluator);
  } catch {
    return { hasComposer: false, challenge: false, url: page.url() };
  }
}

export async function hasCloudflareClearanceCookie(context) {
  try {
    const cookies = await context.cookies();
    return cookies.some((c) => c.name === "cf_clearance" && c.value);
  } catch {
    return false;
  }
}

export async function trySolveTurnstileCheckbox(page, { debug = false } = {}) {
  try {
    for (const frame of page.frames()) {
      if (!/challenges\.cloudflare|turnstile|cdn-cgi/i.test(frame.url())) continue;
      const checkbox = frame.locator(
        'input[type="checkbox"], .ctp-checkbox-label, label.cb-lb, #challenge-stage input, .mark',
      );
      if (await checkbox.count() > 0) {
        const el = checkbox.first();
        const box = await el.boundingBox().catch(() => null);
        if (box) {
          const clickX = box.x + box.width / 2;
          const clickY = box.y + box.height / 2;
          if (debug) console.log(`[cloudflare] turnstile click (${Math.round(clickX)}, ${Math.round(clickY)})`);
          await page.mouse.move(clickX, clickY, { steps: 10 });
          await sleep(120 + Math.random() * 80);
          await page.mouse.down();
          await sleep(60 + Math.random() * 60);
          await page.mouse.up();
          return true;
        }
      }
    }

    const iframe = page.locator('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]').first();
    if (await iframe.count() > 0) {
      const box = await iframe.boundingBox().catch(() => null);
      if (box) {
        const clickX = box.x + Math.min(36, box.width * 0.15);
        const clickY = box.y + box.height / 2;
        if (debug) console.log(`[cloudflare] iframe click (${Math.round(clickX)}, ${Math.round(clickY)})`);
        await page.mouse.move(clickX, clickY, { steps: 10 });
        await sleep(120 + Math.random() * 80);
        await page.mouse.down();
        await sleep(60 + Math.random() * 60);
        await page.mouse.up();
        return true;
      }
    }
  } catch (error) {
    if (debug) console.log(`[cloudflare] turnstile click failed: ${error.message}`);
  }
  return false;
}

export async function humanClickAt(page, x, y) {
  const steps = 8 + Math.floor(Math.random() * 6);
  await page.mouse.move(x, y, { steps });
  await sleep(90 + Math.random() * 110);
  await page.mouse.down();
  await sleep(55 + Math.random() * 75);
  await page.mouse.up();
}

export async function tryAssistCloudflareClick(page, x, y, { debug = false } = {}) {
  await humanClickAt(page, x, y);
  await sleep(400);
  await trySolveTurnstileCheckbox(page, { debug });
  return true;
}

export async function waitForCloudflareClearance(page, { maxMs = 90_000, debug = false } = {}) {
  const deadline = Date.now() + maxMs;
  const context = page.context();

  while (Date.now() < deadline) {
    const state = await detectCloudflareChallenge(page);
    if (!state.challenge) return true;
    if (await hasCloudflareClearanceCookie(context)) {
      await sleep(1500);
      const again = await detectCloudflareChallenge(page);
      if (!again.challenge) return true;
    }
    if (debug) console.log("[cloudflare] waiting for clearance…");
    await trySolveTurnstileCheckbox(page, { debug });
    await sleep(1800);
  }

  return !(await detectCloudflareChallenge(page)).challenge;
}
