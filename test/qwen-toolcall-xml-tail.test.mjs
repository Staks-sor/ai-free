import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repairToolCallJson } from "../api/tool-calls.mjs";

// 2026-09-29, реальные пейлоады из прод-лога: Qwen начинает tool-call JSON,
// а посреди строкового аргумента перескакивает на родной XML — закрывает
// аргумент тегом </parameter> вместо кавычки, следующий аргумент открывает
// тегом <parameter name="...">. Инцидент: чек-лист ГПН, execute_code и
// write_file упали с "Error parsing tool calls from streaming response".

const PAYLOAD_CODE = `[
  {
    "name": "execute_code",
    "arguments": {
      "code": "import sys
sys.path.insert(0, 'D:/Python311/Lib/site-packages')
from docx import Document

doc1 = Document(r'C:\\Users\\User\\AppData\\Local\\hermes\\cache\\documents\\doc_96c7ea9f87ed.docx')
for para in doc1.paragraphs:
    if para.text.strip():
        content1.append(f\"[{para.style.name}] {para.text}\")

print(\"=\" * 80)
print(f\"\\nTables in doc1: {len(doc1.tables)}\")
for i, table in enumerate(doc1.tables[:3]):
    print(f\"\\nTable {i}:\")
    for row in table.rows[:5]:
        cells = [cell.text.strip()[:60] for cell in row.cells]
        print(\" | \".join(cells))
</parameter>
    }
  }
]`;

const PAYLOAD_WRITE_FILE = `[
  {
    "name": "write_file",
    "arguments": {
      "path": "E:/FIREGOAWAY/GitHub/HermesRAG/checklist_gpn_525.json
</parameter>
<parameter name="content">{
  "version": "1.0.0",
  "title": "Чек-лист ГПН Приказ МЧС России от 14.07.2026 № 525",
  "sections": [
    {
      "id": "section1",
      "items": [
        { "id": "1.1", "question": "Вопрос 1.1" },
        { "id": "1.2", "question": "Вопрос 1.2" }
      ]
    }
  ]`;

describe("repairToolCallJson: Qwen mid-string XML switch (2026-09-29)", () => {
  it("execute_code: незакрытая строка закрыта </parameter> вместо кавычки", () => {
    const parsed = repairToolCallJson(PAYLOAD_CODE);
    assert.ok(parsed, "должен распарситься");
    const call = (Array.isArray(parsed) ? parsed : [parsed])[0];
    assert.equal(call.name, "execute_code");
    const code = call.arguments?.code ?? JSON.parse(call.arguments).code;
    assert.match(code, /from docx import Document/);
    assert.match(code, /print\(" \| "\.join\(cells\)\)/);
    assert.ok(!code.includes("</parameter>"), "XML-тег не должен попасть в значение");
  });

  it("write_file: перескок на <parameter name=...> для второго аргумента", () => {
    const parsed = repairToolCallJson(PAYLOAD_WRITE_FILE);
    assert.ok(parsed, "должен распарситься");
    const call = (Array.isArray(parsed) ? parsed : [parsed])[0];
    assert.equal(call.name, "write_file");
    const args = call.arguments && typeof call.arguments === "object" ? call.arguments : JSON.parse(call.arguments);
    assert.equal(args.path, "E:/FIREGOAWAY/GitHub/HermesRAG/checklist_gpn_525.json");
    assert.match(args.content, /"version": "1\.0\.0"/);
    assert.match(args.content, /Чек-лист ГПН/);
  });

  it("валидный JSON с </parameter> внутри ЗНАЧЕНИЯ не ломается", () => {
    const ok = `[{"name":"x","arguments":{"code":"a</parameter>b"}}]`;
    const parsed = repairToolCallJson(ok);
    const call = (Array.isArray(parsed) ? parsed : [parsed])[0];
    const args = call.arguments && typeof call.arguments === "object" ? call.arguments : JSON.parse(call.arguments);
    assert.equal(args.code, "a</parameter>b");
  });
});
