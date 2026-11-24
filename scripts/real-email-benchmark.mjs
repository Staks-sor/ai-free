import fs from "node:fs";
import { ensureOpenAICompatApiKey } from "../src/state/settings.mjs";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: node scripts/real-email-benchmark.mjs /path/to/cases.json");

const API_URL = process.env.AI_FREE_API_URL || "http://127.0.0.1:4318/v1/chat/completions";
const TIMEOUT_MS = Number(process.env.AI_FREE_BENCHMARK_TIMEOUT_MS || 180_000);
const MAX_EVIDENCE_CHARS = Number(process.env.AI_FREE_BENCHMARK_MAX_CHARS || 80_000);
const outputPath = process.env.AI_FREE_BENCHMARK_OUTPUT || "";
const providerFilter = new Set(
  String(process.env.AI_FREE_BENCHMARK_PROVIDERS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const configuredProviders = [
  ["deepseek", "deepseek-v4-flash"],
  ["qwen", "qwen3.8-max"],
  ["googleai", "google-ai-mode"],
];
const providers = providerFilter.size
  ? configuredProviders.filter(([provider]) => providerFilter.has(provider))
  : configuredProviders;
const cases = JSON.parse(fs.readFileSync(inputPath, "utf8")).cases || [];

function parseJson(text) {
  const raw = String(text || "").trim();
  try { return { value: JSON.parse(raw), strict: true }; } catch {}
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { value: null, strict: false };
  try { return { value: JSON.parse(raw.slice(start, end + 1)), strict: false }; } catch {}
  return { value: null, strict: false };
}

function normalize(value) {
  return String(value ?? "").toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function number(value) {
  const cleaned = String(value ?? "").replace(/\s+/g, "").replace(",", ".").replace(/[^0-9.+-]/g, "");
  return cleaned ? Number(cleaned) : null;
}

function unit(value) {
  const normalized = normalize(value).replace(/[.,]+$/g, "");
  if (/^(?:м2|м²|м\.?\s*кв\.?)$/.test(normalized)) return "м²";
  if (/^(?:п\.?\s*м\.?|пог\.?\s*м\.?)$/.test(normalized)) return "пог. м";
  return normalized;
}

function itemMatches(expected, actual) {
  const expectedName = normalize(expected.name);
  const actualName = normalize(actual.name);
  const nameTokens = expectedName.split(/\s+/).filter((token) => token.length > 3);
  const nameMatch = expectedName === actualName || nameTokens.filter((token) => actualName.includes(token)).length >= Math.min(2, nameTokens.length);
  const expectedAddress = normalize(expected.address);
  const actualAddress = normalize(actual.address);
  const addressMatch = !expectedAddress || !actualAddress || expectedAddress === actualAddress
    || expectedAddress.includes(actualAddress) || actualAddress.includes(expectedAddress);
  return nameMatch
    && unit(expected.unit) === unit(actual.unit)
    && number(expected.quantity) === number(actual.quantity)
    && addressMatch;
}

function score(expected, actual) {
  const expectedItems = expected?.items || [];
  const actualItems = actual?.items || [];
  const unmatchedActual = [...actualItems];
  let matched = 0;
  for (const item of expectedItems) {
    const index = unmatchedActual.findIndex((candidate) => itemMatches(item, candidate));
    if (index < 0) continue;
    matched += 1;
    unmatchedActual.splice(index, 1);
  }
  return {
    expected_items: expectedItems.length,
    actual_items: actualItems.length,
    matched_items: matched,
    address_expected: Boolean(expected?.address),
    address_found: Boolean(actual?.project_address || actualItems.some((item) => item.address)),
  };
}

function promptFor(testCase) {
  const evidence = String(testCase.evidence || "").slice(0, MAX_EVIDENCE_CHARS);
  return `Ты извлекаешь данные для коммерческого предложения из реального письма и его вложений.
Верни только JSON без markdown по схеме:
{"project_address":string|null,"items":[{"name":string,"unit":string|null,"quantity":number|null,"address":string|null}],"warnings":[string]}.
Правила: ничего не придумывай; цену не принимай за объём; строку ИТОГО не делай работой; сохраняй связь каждого адреса с его работой; если поле сомнительно, верни null; расчёты не выполняй.

ИСХОДНЫЕ ДАННЫЕ:
${evidence}`;
}

const report = [];
for (const [provider, model] of providers) {
  const apiKey = ensureOpenAICompatApiKey(provider);
  for (const testCase of cases) {
    const started = Date.now();
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: promptFor(testCase) }], stream: false }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await response.json();
      const content = body?.choices?.[0]?.message?.content || "";
      const parsed = parseJson(content);
      report.push({
        provider,
        model,
        case_id: testCase.case_id,
        http_status: response.status,
        duration_ms: Date.now() - started,
        strict_json: parsed.strict,
        ...(parsed.value ? score(testCase.expected, parsed.value) : { error: body?.error?.message || "invalid_json" }),
        result: parsed.value,
        extraction_errors: testCase.extraction_errors || [],
      });
    } catch (error) {
      report.push({ provider, model, case_id: testCase.case_id, duration_ms: Date.now() - started, error: error.message });
    }
    const current = report.at(-1);
    console.log(JSON.stringify({ ...current, result: undefined, extraction_errors: current.extraction_errors?.length || 0 }));
  }
}

if (outputPath) fs.writeFileSync(outputPath, JSON.stringify({ generated_at: new Date().toISOString(), report }, null, 2));
