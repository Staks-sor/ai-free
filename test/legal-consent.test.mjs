import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  createConsentStore,
  validateConsentSubmission,
} from "../src/legal/consent-store.mjs";

describe("legal consent store", () => {
  it("requires separate acceptance of terms and personal-data processing", () => {
    assert.throws(
      () => validateConsentSubmission({ legalVersion: "2026-08-31", termsAccepted: true, alphaAcknowledged: true }),
      /personal-data/i,
    );
    assert.doesNotThrow(() => validateConsentSubmission({
      legalVersion: "2026-08-31",
      termsAccepted: true,
      personalDataAccepted: true,
      alphaAcknowledged: true,
    }));
  });

  it("persists a versioned audit record and returns current status", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "synvox-consent-"));
    const store = createConsentStore({ directory, now: () => new Date("2026-08-31T10:00:00.000Z") });
    const saved = store.record({
      legalVersion: "2026-08-31",
      termsAccepted: true,
      personalDataAccepted: true,
      alphaAcknowledged: true,
      appVersion: "0.4.25",
    });

    assert.equal(saved.storage, "mock-local");
    assert.equal(saved.record.acceptedAt, "2026-08-31T10:00:00.000Z");
    assert.equal(saved.record.legalVersion, "2026-08-31");
    assert.equal(store.status("2026-08-31").accepted, true);
    assert.equal(store.status("next-version").accepted, false);
  });
});
