# SYNVOX: isolated licensing prototype

Not deployed. Existing releases remain free; enforcement defaults OFF. Never publish this mock service or include its private data in an archive. The local service requires Node 22.13+ (node:sqlite); the client verifier does not import SQLite.

## Local test

The development client now creates a persistent installation key automatically when licensing is enabled and the server/public signing key are configured. The default file is `~/.deepseek-cli/synvox-installation.json` (outside application updates); `SYNVOX_LICENSE_IDENTITY_FILE` overrides it. The key is written before the registration request. Retrying registration with the same key returns the existing license and never restarts its trial. A corrupt file is not overwritten. A separate installation data directory gets a separate license; two application folders using the same user-data directory intentionally share that installation identity.

Storage uses owner-only file permissions, not OS keychain encryption or hardware binding. Copying this secret file can clone access. Installation key-pair proof, secure migration/recovery and production registration deployment are still pending. This implementation does not claim clone resistance.

Use an absolute private directory outside this repository and Downloads. Start:

```
node services/licensing/server.mjs /absolute/private/synvox-license-test
node scripts/license-dev.mjs register /absolute/private/synvox-license-test/identity.json
```

Set in the environment of a DEVELOPMENT client only:

```
SYNVOX_LICENSE_ENFORCE=1
SYNVOX_LICENSE_URL=http://127.0.0.1:4329
SYNVOX_LICENSE_PUBLIC_KEY_FILE=/absolute/private/synvox-license-test/public.pem
SYNVOX_LICENSE_IDENTITY_FILE=/absolute/private/synvox-license-test/identity.json
```

Run `npm start` in that environment. Trial is 3 days. Read the documents first, then explicitly record test consent before a test payment:

```
node scripts/license-dev.mjs accept-consents /absolute/private/synvox-license-test/identity.json --confirm
node scripts/license-dev.mjs mock-pay /absolute/private/synvox-license-test/identity.json
```

This credits 30 days; no real money or fiscal receipt. Keys are hashed in SQLite; the private identity file contains the bearer secret. Payments are transactional and one order is credited once. Re-running mock-pay creates a NEW order deliberately.

## Desktop preparation

### Live read-only connection (2026-09-07)

Public metadata is deployed at `https://synvox.pro/api/v1/subscription/config.json`. The desktop `/api/subscription` endpoint reads it over HTTPS with a five-second timeout and no redirects, combines it with local access verification, and never sends an identity/key to this metadata endpoint. Unsupported/unavailable data falls back to payment-disabled defaults. Metadata cannot grant access or enable checkout in this client version.

Server release: `/var/www/synvox/releases/20260907-subscription-config`; previous release `/var/www/synvox/releases/20260907-search-0920` remains available for rollback. Only the metadata file was added; public pages and downloads are unchanged. Node is not installed on the live server. No licensing database or mock service was deployed. Server-backed user identity, consent synchronization and real payment callbacks remain pending; do not set `SYNVOX_CONTROL_PLANE_URL` to the website yet, because those routes are not implemented there.

Settings → Подписка shows access status, 99 RUB / 30 days, the three-day trial terms, and public links to https://synvox.pro/ and https://synvox.pro/documents/. Payment is explicitly unavailable pending shop activation. Refresh uses GET `/api/subscription`; no identity key or signed proof is returned to the UI. Free releases are labelled as free, not as paid subscriptions.

The mock server accepts POST `/v1/license/consents` with explicit `termsAccepted`, `personalDataAccepted`, `alphaAcknowledged` booleans and `legalVersion: "2026-09-07"`. It records the authenticated installation, version and server timestamp in SQLite; repeated submission preserves the original timestamp. Checkout rejects missing or stale consent. This is an API preparation, not a deployed website consent flow; existing local consents are not silently migrated.

Visual verification used an isolated component fixture at 1280×800 and 390×844, including computed link target size and overflow checks. Full application/account/payment end-to-end verification is still required.

## Enforcement

Desktop/Telegram conversation sends, local OpenAI/Responses/Anthropic execution, CLI prompts and ACP prompts check signed access. Existing data is never deleted. Update, login, cancellation and read/export routes remain available. No subscription means 402, required update 426, unavailable licensing 503. A previously verified proof can be reused in process memory until its signed expiry (24h), but never beyond paid/trial access. Restart during an outage requires reconnecting. Revocation and minimum version changes can be delayed up to that cache lifetime when offline. Local clock and code are user-controlled; this is not tamper-proof DRM.

## Not production-ready

- Registration is local/test only, not email-verified: deleting identity and registering again can create another trial. Production needs verified account identity, recovery, rate limits and anti-abuse.
- No production HTTP deployment, real Robokassa/Stars callbacks, fiscal receipts, website consent form connection, promo/admin UI or self-service account screen yet.
- Public signing key and server address are environment-configured for development; production releases must pin trusted configuration. Never ship signing secrets.
- No ongoing-task termination: access is checked before task submission. Local STT/browser tools are not paywalled in this prototype.
- Published plugin packages and desktop baseline are unchanged. Plugin source synchronization and full end-to-end subscription UI remain separate work before release.

Run: `node --test test/license-access.test.mjs test/license-client.test.mjs test/license-http.test.mjs test/license-settings.test.mjs test/license-consents.test.mjs`.
