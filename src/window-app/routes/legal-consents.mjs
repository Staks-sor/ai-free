import { AI_FREE_VERSION } from "../../config.mjs";
import { createConsentStore, validateConsentSubmission } from "../../legal/consent-store.mjs";
import { readJsonBody, sendJson } from "../http.mjs";

const store = createConsentStore();

function controlPlaneUrl(pathname) {
  const base = String(process.env.SYNVOX_CONTROL_PLANE_URL || "").trim().replace(/\/$/, "");
  return base ? `${base}${pathname}` : "";
}

async function readRemoteResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Consent server returned HTTP ${response.status}`);
  return data;
}

export async function handleLegalConsentRoute(req, url, res) {
  if (url.pathname !== "/api/legal/consents") return false;

  if (req.method === "GET") {
    const legalVersion = String(url.searchParams.get("version") || "");
    const remote = controlPlaneUrl(`/api/v1/legal/consents/status?version=${encodeURIComponent(legalVersion)}&installationId=${encodeURIComponent(store.installationId())}`);
    if (remote) {
      try {
        const response = await fetch(remote, { signal: AbortSignal.timeout(8_000) });
        sendJson(res, await readRemoteResponse(response));
      } catch (error) {
        sendJson(res, { error: `Сервер согласий недоступен: ${error.message}` }, 503);
      }
      return true;
    }
    sendJson(res, store.status(legalVersion));
    return true;
  }

  if (req.method === "POST") {
    try {
      const consent = validateConsentSubmission(await readJsonBody(req));
      const payload = {
        ...consent,
        appVersion: consent.appVersion || AI_FREE_VERSION,
        installationId: store.installationId(),
      };
      const remote = controlPlaneUrl("/api/v1/legal/consents");
      if (remote) {
        const response = await fetch(remote, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8_000),
        });
        sendJson(res, await readRemoteResponse(response), 201);
      } else {
        sendJson(res, store.record(payload), 201);
      }
    } catch (error) {
      sendJson(res, { error: error.message }, /required|accepted/i.test(error.message) ? 400 : 503);
    }
    return true;
  }

  sendJson(res, { error: "Method not allowed" }, 405);
  return true;
}

