import { ensureOpenAICompatApiKey } from "../src/state/settings.mjs";

const API_URL = process.env.AI_FREE_API_URL || "http://127.0.0.1:4318/v1/chat/completions";
const TIMEOUT_MS = Number(process.env.AI_FREE_BENCHMARK_TIMEOUT_MS || 180_000);

const configuredProviders = [
  ["deepseek", "deepseek-v4-flash"],
  ["qwen", "qwen3.8-max"],
  ["googleai", "google-ai-mode"],
];
const providerFilter = new Set(
  String(process.env.AI_FREE_BENCHMARK_PROVIDERS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const providers = providerFilter.size
  ? configuredProviders.filter(([provider]) => providerFilter.has(provider))
  : configuredProviders;
const verbose = process.env.AI_FREE_BENCHMARK_VERBOSE === "1";

const cases = [
  {
    case_id: "docx_prose_multi_address",
    evidence: "DOCX paragraphs: Столярный пер. д.3, корп.8: Мойка проемов — 554,2 м². Столярный пер. д.3, корп.14: Мойка оконных проемов — 3357,08 м²; мойка козырьков — 82,56 м².",
    expected: [
      ["корп.8", "мойка проемов", "м²", 554.2],
      ["корп.14", "мойка оконных проемов", "м²", 3357.08],
      ["корп.14", "мойка козырьков", "м²", 82.56],
    ],
  },
  {
    case_id: "xlsx_shifted_columns",
    evidence: "XLSX Лист 'Смета', исходные колонки: Цена | пусто | Адрес объекта | Вид работ | Объём | Ед. изм. Строка 18: 350000 | | г. Москва, ул. Тверская, д.12 | Мойка фасада | 12000 | м².",
    expected: [["тверская", "мойка фасада", "м²", 12000]],
  },
  {
    case_id: "scan_pdf_ocr_grid",
    evidence: "OCR PDF page 2 table. Headers: № | Наименование работ | Периметр корпусов | Площадь кровли. Row 1: 1 | Очистка кровли корпуса №1 | 220 п.м. | 4381 м². Row 2: 2 | Очистка кровли корпуса №4 | 140 п.м. | 667 м². Итог: 360 п.м. | 5048 м².",
    expected: [
      [null, "корпуса №1", "пог. м", 220],
      [null, "корпуса №1", "м²", 4381],
      [null, "корпуса №4", "пог. м", 140],
      [null, "корпуса №4", "м²", 667],
    ],
  },
  {
    case_id: "email_vertical_table",
    evidence: "Email body: Мойка внешнего остекления / м. кв. / 1 420,00. Мойка фасада с 4-х сторон / м. кв. / 5 515,00. Адрес: Москва, Озерковская наб., д.30. Просьба рассчитать стоимость.",
    expected: [
      ["озерковская", "мойка внешнего остекления", "м²", 1420],
      ["озерковская", "мойка фасада с 4-х сторон", "м²", 5515],
    ],
  },
  {
    case_id: "two_zip_one_email",
    evidence: "Одно письмо одного отправителя содержит два архива. ZIP A/member docs/address.txt: Объект: г. Москва, Смоленский бульвар, д.4. ZIP A/member tables/works.xlsx: Мойка окон и отливов | м² | 436. ZIP B/member docs/address.txt: Объект: г. Москва, ул. Тимура Фрунзе, д.11, стр.44. ZIP B/member tables/works.xlsx: Мойка окон, отливов и фасадов | м² | 2024. Не смешивать адреса между архивами.",
    expected: [
      ["смоленский", "мойка окон и отливов", "м²", 436],
      ["тимура фрунзе", "мойка окон, отливов и фасадов", "м²", 2024],
    ],
  },
];

const prompt = `Верни только один JSON-объект без markdown, комментариев и рассуждений.
Схема: {"cases":[{"case_id":string,"items":[{"address":string|null,"name":string,"unit":string|null,"quantity":number|null}]}]}.
Правила: не выдумывай данные; не используй цены как объёмы; строки "Итого" не являются работами; при нескольких измерениях одной работы создай отдельную строку на каждое измерение; сохраняй связь адреса с файлом/архивом.
Входные случаи:
${cases.map(({ case_id, evidence }) => `CASE ${case_id}: ${evidence}`).join("\n")}`;

function parseStrictJson(text) {
  try {
    return { value: JSON.parse(String(text).trim()), strict: true };
  } catch {}
  const source = String(text);
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return { value: null, strict: false };
  try {
    return { value: JSON.parse(source.slice(start, end + 1)), strict: false };
  } catch {
    return { value: null, strict: false };
  }
}

function normalize(value) {
  return String(value ?? "").toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim();
}

function normalizeUnit(value) {
  const unit = normalize(value).replace(/[.,]+$/g, "");
  if (/^(?:м2|м²|м\.?\s*кв\.?)$/.test(unit)) return "м²";
  if (/^(?:п\.?\s*м\.?|пог\.?\s*м\.?)$/.test(unit)) return "пог. м";
  return unit;
}

function score(payload) {
  const actualCases = new Map((payload?.cases || []).map((item) => [item.case_id, item.items || []]));
  let checks = 0;
  let passed = 0;
  const details = [];
  for (const testCase of cases) {
    const actual = actualCases.get(testCase.case_id) || [];
    let casePassed = 0;
    for (const [addressPart, namePart, unit, quantity] of testCase.expected) {
      checks += 1;
      const found = actual.some((item) => (
        (!addressPart || normalize(item.address).includes(addressPart))
        && normalize(item.name).includes(namePart)
        && normalizeUnit(item.unit) === normalizeUnit(unit)
        && Number(item.quantity) === quantity
      ));
      if (found) {
        passed += 1;
        casePassed += 1;
      }
    }
    details.push(`${testCase.case_id}:${casePassed}/${testCase.expected.length}`);
  }
  return { passed, checks, details };
}

for (const [provider, model] of providers) {
  const started = Date.now();
  try {
    const apiKey = ensureOpenAICompatApiKey(provider);
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], stream: false }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content || "";
    const parsed = parseStrictJson(content);
    const result = parsed.value ? score(parsed.value) : { passed: 0, checks: 12, details: ["invalid_json"] };
    console.log(JSON.stringify({
      provider,
      model,
      http_status: response.status,
      duration_ms: Date.now() - started,
      strict_json: parsed.strict,
      ...result,
    }));
    if (verbose) console.log(content);
  } catch (error) {
    console.log(JSON.stringify({
      provider,
      model,
      duration_ms: Date.now() - started,
      error: error.message,
    }));
  }
}
