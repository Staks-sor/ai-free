import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { AUTH_DIR } from "../config.mjs";

const DEFAULT_FILE = "legal-consents.mock.json";

export function validateConsentSubmission(input = {}) {
  if (!String(input.legalVersion || "").trim()) {
    throw new Error("legalVersion is required");
  }
  if (input.termsAccepted !== true || input.alphaAcknowledged !== true) {
    throw new Error("Terms and alpha status must be accepted");
  }
  if (input.personalDataAccepted !== true) {
    throw new Error("Separate personal-data consent is required");
  }
  return {
    legalVersion: String(input.legalVersion).trim(),
    termsAccepted: true,
    personalDataAccepted: true,
    alphaAcknowledged: true,
    appVersion: String(input.appVersion || "").trim(),
  };
}

export function createConsentStore({ directory = AUTH_DIR, now = () => new Date() } = {}) {
  const file = path.join(directory, DEFAULT_FILE);

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && Array.isArray(parsed.records) && parsed.installationId) return parsed;
    } catch {}
    return { installationId: randomUUID(), records: [] };
  }

  function save(data) {
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, file);
  }

  function installationId() {
    const data = load();
    if (!fs.existsSync(file)) save(data);
    return data.installationId;
  }

  function record(input) {
    const consent = validateConsentSubmission(input);
    const data = load();
    const entry = {
      id: randomUUID(),
      installationId: data.installationId,
      acceptedAt: now().toISOString(),
      ...consent,
    };
    data.records.push(entry);
    save(data);
    return { ok: true, storage: "mock-local", record: entry };
  }

  function status(legalVersion) {
    const data = load();
    const record = [...data.records].reverse().find((item) => item.legalVersion === legalVersion);
    return {
      accepted: Boolean(record),
      storage: "mock-local",
      installationId: data.installationId,
      record: record || null,
    };
  }

  return { installationId, record, status };
}

